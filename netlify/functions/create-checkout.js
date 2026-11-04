// Netlify Function : reçoit la confirmation de paiement de Stripe (webhook)
// puis envoie 2 mails via Resend : un au client, un à la boutique.
// Variables requises : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY

const crypto = require('crypto');

const STORE_EMAIL = process.env.STORE_EMAIL || 'unnamedarea08@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || 'UNNAMED AREA <onboarding@resend.dev>';

exports.handler = async (event) => {
  console.log('Webhook reçu, méthode :', event.httpMethod);
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Méthode non autorisée' };

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');

    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!process.env.STRIPE_WEBHOOK_SECRET) console.error('ERREUR : STRIPE_WEBHOOK_SECRET absente');
    if (!verifySignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      console.error('ERREUR : signature Stripe invalide');
      return { statusCode: 400, body: 'Signature invalide' };
    }
    console.log('Signature OK');

    const stripeEvent = JSON.parse(rawBody);
    if (stripeEvent.type !== 'checkout.session.completed') {
      return { statusCode: 200, body: 'Événement ignoré' };
    }

    const session = stripeEvent.data.object;
    const items = await getLineItems(session.id);
    console.log('Articles récupérés :', items.length);

    const customerEmail = session.customer_details && session.customer_details.email;
    const orderRef = 'UA-' + session.id.slice(-6).toUpperCase();
    const total = (session.amount_total / 100).toFixed(2).replace('.', ',') + ' €';
    const lines = items.map(i => `- ${i.description} x${i.quantity} : ${(i.amount_total / 100).toFixed(2).replace('.', ',')} €`).join('\n');

    // Les mails ne doivent pas faire échouer la réponse : on note l'erreur et on répond quand même
    if (customerEmail) {
      await safeSend({
        to: customerEmail,
        subject: `Merci, ta commande ${orderRef} est confirmée`,
        text: `Merci d'avoir rejoint la zone.\n\nTa commande ${orderRef} est bien reçue, on la prépare avec soin.\nTu recevras un message dès qu'elle part.\n\nRécapitulatif :\n${lines}\nTotal : ${total}\n\nBienvenue dans UNNAMED AREA.`,
      });
    }

    await safeSend({
      to: STORE_EMAIL,
      subject: `Nouvelle commande ${orderRef} — ${total}`,
      text: `Nouvelle commande ${orderRef}\n\nClient : ${session.customer_details ? session.customer_details.name : '-'}\nEmail : ${customerEmail || '-'}\nTéléphone : ${session.customer_details && session.customer_details.phone ? session.customer_details.phone : '-'}\n\nAdresse de livraison :\n${formatAddress(session)}\n\nArticles :\n${lines}\n\nTotal payé : ${total}\nRéférence Stripe : ${session.id}`,
    });

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Erreur webhook :', err && err.message ? err.message : err);
    return { statusCode: 500, body: 'Erreur' };
  }
};

async function safeSend(mail) {
  try {
    await sendMail(mail);
    console.log('Mail envoyé à', mail.to);
  } catch (err) {
    console.error('Erreur envoi mail vers', mail.to, ':', err.message);
  }
}

function verifySignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + payload, 'utf8').digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getLineItems(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`, {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Stripe line_items : ' + (data.error ? data.error.message : res.status));
  return data.data || [];
}

function formatAddress(session) {
  const a = session.customer_details && session.customer_details.address;
  if (!a) return '-';
  return [a.line1, a.line2, `${a.postal_code || ''} ${a.city || ''}`.trim(), a.country].filter(Boolean).join('\n');
}

async function sendMail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY absente');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error('Resend : ' + (await res.text()));
}

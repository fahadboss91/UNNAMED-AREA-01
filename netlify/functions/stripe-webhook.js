// Netlify Function : reçoit la confirmation de paiement de Stripe (webhook)
// puis envoie 2 mails via Resend : un au client (remerciement), un à la boutique (commande).
// Variables Netlify requises : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY
// Optionnelle : STORE_EMAIL (adresse qui reçoit les commandes), MAIL_FROM (expéditeur)

const crypto = require('crypto');

const STORE_EMAIL = process.env.STORE_EMAIL || 'unnamedarea08@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || 'UNNAMED AREA <onboarding@resend.dev>';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Méthode non autorisée' };

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  // 1. Vérifier que la requête vient bien de Stripe
  if (!verifySignature(rawBody, event.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return { statusCode: 400, body: 'Signature invalide' };
  }

  const stripeEvent = JSON.parse(rawBody);
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Événement ignoré' };
  }

  try {
    const session = stripeEvent.data.object;
    const items = await getLineItems(session.id);
    const customerEmail = session.customer_details && session.customer_details.email;
    const orderRef = 'UA-' + session.id.slice(-6).toUpperCase();
    const total = (session.amount_total / 100).toFixed(2).replace('.', ',') + ' €';
    const address = formatAddress(session);
    const lines = items.map(i => `- ${i.description} x${i.quantity} : ${(i.amount_total / 100).toFixed(2).replace('.', ',')} €`).join('\n');

    // 2. Mail de remerciement au client
    if (customerEmail) {
      await sendMail({
        to: customerEmail,
        subject: `Merci, ta commande ${orderRef} est confirmée`,
        text:
`Merci d'avoir rejoint la zone.

Ta commande ${orderRef} est bien reçue, on la prépare avec soin.
Tu recevras un message dès qu'elle part.

Récapitulatif :
${lines}
Total : ${total}

Bienvenue dans UNNAMED AREA.`,
      });
    }

    // 3. Mail de commande pour la boutique
    await sendMail({
      to: STORE_EMAIL,
      subject: `Nouvelle commande ${orderRef} — ${total}`,
      text:
`Nouvelle commande ${orderRef}

Client : ${session.customer_details ? session.customer_details.name : '-'}
Email : ${customerEmail || '-'}
Téléphone : ${session.customer_details && session.customer_details.phone ? session.customer_details.phone : '-'}

Adresse de livraison :
${address}

Articles :
${lines}

Total payé : ${total}
Référence Stripe : ${session.id}`,
    });

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Erreur webhook :', err);
    return { statusCode: 500, body: 'Erreur' };
  }
};

// Vérifie la signature envoyée par Stripe
function verifySignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + payload, 'utf8').digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Récupère les articles de la commande auprès de Stripe
async function getLineItems(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`, {
    headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
  });
  const data = await res.json();
  return data.data || [];
}

function formatAddress(session) {
  const a = session.customer_details && session.customer_details.address;
  if (!a) return '-';
  return [a.line1, a.line2, `${a.postal_code || ''} ${a.city || ''}`.trim(), a.country].filter(Boolean).join('\n');
}

// Envoi via Resend
async function sendMail({ to, subject, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error('Resend : ' + (await res.text()));
}

// Netlify Function : crée une session Stripe Checkout (paiement sécurisé hébergé par Stripe)
// La clé secrète reste dans Netlify (variable STRIPE_SECRET_KEY), jamais dans le site.

// Catalogue de référence : le prix est toujours décidé ici, jamais par le navigateur.
const CATALOG = {
  'Jersey 08 — Noir': 35,
  'Jersey 08 — Blanc': 35,
  'T-Shirt Oversized Camo Crest Pure White': 35,
  'T-Shirt Oversized Camo Crest Deep Black': 35,
};
const SIZES = ['S', 'M', 'L', 'XL'];
const SHIPPING_CENTS = 500;     // 5 €
const FREE_SHIPPING_QTY = 2;    // livraison offerte dès 2 articles
const SITE_URL = process.env.SITE_URL || 'https://example.netlify.app';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée' };
  }
  try {
    const { items } = JSON.parse(event.body || '{}');
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { error: 'Panier vide' });
    }

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', SITE_URL + '/?commande=ok');
    params.append('cancel_url', SITE_URL + '/?commande=annulee#collection');
    params.append('locale', 'fr');
    params.append('shipping_address_collection[allowed_countries][0]', 'FR');
    params.append('billing_address_collection', 'required');
    params.append('phone_number_collection[enabled]', 'true');
    params.append('allow_promotion_codes', 'true'); // code ZERO8 saisissable au paiement

    let qty = 0;
    let i = 0;
    for (const item of items) {
      const price = CATALOG[item.name];
      const quantity = Math.max(1, Math.min(10, parseInt(item.quantity, 10) || 1));
      if (price === undefined) return json(400, { error: 'Article inconnu : ' + item.name });
      if (!SIZES.includes(item.size)) return json(400, { error: 'Taille invalide' });
      qty += quantity;
      const p = `line_items[${i}]`;
      params.append(`${p}[quantity]`, String(quantity));
      params.append(`${p}[price_data][currency]`, 'eur');
      params.append(`${p}[price_data][unit_amount]`, String(price * 100));
      params.append(`${p}[price_data][product_data][name]`, item.name);
      params.append(`${p}[price_data][product_data][description]`, 'Taille ' + item.size);
      i++;
    }

    if (qty < FREE_SHIPPING_QTY) {
      const p = `line_items[${i}]`;
      params.append(`${p}[quantity]`, '1');
      params.append(`${p}[price_data][currency]`, 'eur');
      params.append(`${p}[price_data][unit_amount]`, String(SHIPPING_CENTS));
      params.append(`${p}[price_data][product_data][name]`, 'Livraison');
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) return json(500, { error: data.error ? data.error.message : 'Erreur Stripe' });
    return json(200, { url: data.url });
  } catch (err) {
    return json(500, { error: 'Erreur serveur' });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

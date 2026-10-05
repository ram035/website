// One-time move (1/10/2026): the home and Music Composer pages go from fixed
// sections in content/site.json to blocks in content/pages/*.json. Every text
// is carried over as it is. site.json keeps only the site's shared data.
// A copy of the old site.json is kept in content/_backups/.
//
//   node tools/migrate-to-blocks.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'content', 'site.json');
const PAGES = path.join(ROOT, 'content', 'pages');
const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!c.home) { console.log('Already done: site.json has no "home" section.'); process.exit(0); }

let n = 0;
const id = () => 'b' + (++n).toString(36) + Math.random().toString(36).slice(2, 6);
const both = (v) => ({ en: v, es: v });
const join = (a, b) => ({ en: [a.en, b.en].filter(Boolean).join(' · '), es: [a.es, b.es].filter(Boolean).join(' · ') });
const block = (type, props, style) => ({ id: id(), type, hidden: false, style: style || {}, props });
const items = list => (list || []).map(text => ({ text }));

const h = c.home, mc = c.musicComposer;

const home = {
  path: '',
  title: { en: `Gavna — ${c.site.tagline.en}`, es: `Gavna — ${c.site.tagline.es}` },
  description: c.site.description,
  image: mc.card.image,
  blocks: [
    block('hero', {
      layout: 'split', eyebrow: h.hero.eyebrow, title: h.hero.title, text: h.hero.text,
      buttons: [
        { label: h.hero.ctaPrimary, link: 'page:music-composer', style: 'red' },
        { label: h.hero.ctaSecondary, link: '#about', style: 'ghost' }
      ],
      note: { en: '', es: '' }, media: 'lottie', lottie: 'galaxy.json', glow: true, image: { en: '', es: '' }
    }),
    block('showcase', {
      eyebrow: h.products.eyebrow, name: mc.name, logo: both('img/music-composer-logo.svg'), link: 'page:music-composer',
      text: mc.card.text, image: mc.card.image,
      cards: h.products.highlights.map(x => ({ title: x.title, text: x.text })),
      buttons: [{ label: h.products.cardCta, link: 'page:music-composer', style: 'red' }],
      note: join(mc.platform, mc.hero.note), available: true
    }, { anchor: 'products' }),
    block('text', {
      title: h.about.title, paragraphs: items(h.about.paragraphs), size: 'l', highlight: h.about.credit
    }, { bg: 'alt', anchor: 'about' }),
    block('contact', { title: h.contact.title, text: h.contact.text }, { anchor: 'contact' })
  ]
};

const product = {
  path: 'music-composer',
  title: { en: `${mc.name} — ${mc.hero.title.en}`, es: `${mc.name} — ${mc.hero.title.es}` },
  description: mc.card.text,
  image: mc.hero.image,
  blocks: [
    block('productbar', {
      name: mc.name, logo: both('img/music-composer-logo.svg'), logoLink: 'page:music-composer',
      links: [
        { label: c.nav.features, link: '#features' },
        { label: c.nav.pricing, link: '#pricing' },
        { label: c.nav.faq, link: '#faq' }
      ],
      button: true
    }),
    block('hero', {
      layout: 'center', eyebrow: mc.hero.eyebrow, title: mc.hero.title, text: mc.hero.text,
      buttons: [
        { label: { en: '', es: '' }, link: 'store:', style: 'red' },
        { label: { en: '', es: '' }, link: 'buy:', style: 'ghost' },
        { label: mc.hero.ctaSecondary, link: '#features', style: 'ghost' }
      ],
      note: mc.hero.note, media: 'image', lottie: '', glow: false, image: mc.hero.image
    }),
    block('stats', { items: mc.stats.map(s => ({ value: s.value, label: s.label })) }),
    ...mc.features.map((f, i) => block('feature', {
      side: i % 2 ? 'left' : 'right', kicker: f.kicker, title: f.title, text: f.text, bullets: items(f.bullets), image: f.image, zoom: true
    }, i === 0 ? { anchor: 'features' } : {})),
    block('cards', { title: mc.moreTitle, columns: '3', items: mc.more.map(m => ({ title: m.title, text: m.text })) }),
    block('pricing', {
      name: mc.name, logo: both('img/music-composer-logo.svg'), title: mc.pricing.title, per: mc.pricing.per,
      bullets: items(mc.pricing.bullets), follow: mc.pricing.follow,
      specsTitle: mc.requirements.title, specs: items(mc.requirements.items),
      manualTitle: mc.requirements.manualTitle, manualFile: mc.requirements.manualFile, manualLabel: mc.requirements.manualLabel
    }, { anchor: 'pricing' }),
    block('faq', {
      title: mc.faqTitle, items: mc.faq.map(f => ({ q: f.q, a: f.a })), supportTitle: mc.support.title, supportText: mc.support.text
    }, { anchor: 'faq' })
  ]
};

// what site.json keeps: the site's data and the texts every page shares
const next = {
  site: c.site,
  nav: {
    products: c.nav.products,
    links: [
      { label: c.nav.about, link: 'page:home#about' },
      { label: c.nav.contact, link: 'page:home#contact' }
    ]
  },
  musicComposer: {
    name: mc.name, tagline: mc.hero.eyebrow, price: mc.price, currency: mc.currency,
    storeUrl: mc.storeUrl, checkoutUrl: mc.checkoutUrl, download: mc.download, buyButton: mc.pricing.buyButton
  },
  purchased: c.purchased,
  footer: Object.assign({}, c.footer, { contactTitle: c.nav.contact })
};

const backups = path.join(ROOT, 'content', '_backups');
fs.mkdirSync(backups, { recursive: true });
fs.copyFileSync(FILE, path.join(backups, `site-${new Date().toISOString().replace(/[:.]/g, '-')}-before-blocks.json`));
fs.mkdirSync(PAGES, { recursive: true });
fs.writeFileSync(path.join(PAGES, 'home.json'), JSON.stringify(home, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(PAGES, 'music-composer.json'), JSON.stringify(product, null, 2) + '\n', 'utf8');
fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
console.log('Done: content/pages/home.json, content/pages/music-composer.json, and a shorter site.json.');

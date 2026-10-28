// Mobile menu, quote links on the solution cards, and the quote form.
// No dependencies, so it keeps working if the 3D scene or the CDN fails.

const menuButton = document.querySelector('.menu-btn');
const menu = document.getElementById('mobile-menu');

function setMenu(open) {
  menu.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? 'Close' : 'Menu';
}

menuButton.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.hidden) {
    setMenu(false);
    menuButton.focus();
  }
});
window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
  if (event.matches) setMenu(false);
});

const form = document.getElementById('quote-form');
const done = document.getElementById('quote-done');

// "Get a quote" on a card preselects that project type
document.querySelectorAll('[data-quote-type]').forEach((link) => {
  link.addEventListener('click', () => {
    const radio = form.querySelector(`input[name="type"][value="${link.dataset.quoteType}"]`);
    if (radio) radio.checked = true;
    clearError('type');
  });
});

const TYPE_LABELS = {
  residential: 'Residential roof',
  commercial: 'Commercial field',
  offgrid: 'Off-grid site',
};

const parseAmount = (raw) => {
  const cleaned = raw.replace(/[€\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
};

const rules = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Enter your full name.'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Enter an email address like name@example.com.'),
  type: () => (form.querySelector('input[name="type"]:checked') ? '' : 'Choose the kind of site.'),
  postcode: (v) => (/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(v.trim()) ? '' : 'Enter the postcode of the site.'),
  bill: (v) => {
    const amount = parseAmount(v);
    return amount >= 20 && amount <= 100000 ? '' : 'Enter your average monthly bill in euros, between €20 and €100,000.';
  },
  consent: () => (form.elements.consent.checked ? '' : 'Tick the box so we can reply to you.'),
};

function showError(name, message) {
  const fields = name === 'type' ? form.querySelectorAll('input[name="type"]') : [form.elements[name]];
  document.getElementById(`q-${name}-err`).textContent = message;
  fields.forEach((field) => field.setAttribute('aria-invalid', message ? 'true' : 'false'));
}

function clearError(name) {
  showError(name, '');
}

function validate(name) {
  const field = form.elements[name];
  const value = field && 'value' in field ? field.value : '';
  const message = rules[name](value);
  showError(name, message);
  return message === '';
}

let submitted = false;
form.addEventListener('input', (event) => {
  const name = event.target.name;
  if (submitted && rules[name]) validate(name);
});
form.addEventListener('focusout', (event) => {
  const name = event.target.name;
  if (submitted && rules[name] && name !== 'type') validate(name);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitted = true;
  const invalid = Object.keys(rules).filter((name) => !validate(name));
  if (invalid.length) {
    const first = invalid[0] === 'type' ? form.querySelector('input[name="type"]') : form.elements[invalid[0]];
    first.focus();
    return;
  }

  const data = new FormData(form);
  const firstName = data.get('name').trim().split(/\s+/)[0];
  const reference = `HEL-${Math.floor(1000 + Math.random() * 9000)}`;
  const bill = parseAmount(data.get('bill'));

  done.querySelector('[data-out="greeting"]').textContent = `Thanks, ${firstName}.`;
  done.querySelector('[data-out="reference"]').textContent = reference;
  done.querySelector('[data-out="type"]').textContent = TYPE_LABELS[data.get('type')];
  done.querySelector('[data-out="postcode"]').textContent = data.get('postcode').trim().toUpperCase();
  done.querySelector('[data-out="bill"]').textContent = `€${bill.toLocaleString('en-GB', { maximumFractionDigits: 2 })} per month`;
  done.querySelector('[data-out="email"]').textContent = data.get('email').trim();

  form.hidden = true;
  done.hidden = false;
  done.focus();
});

done.querySelector('.again').addEventListener('click', () => {
  form.reset();
  submitted = false;
  Object.keys(rules).forEach(clearError);
  done.hidden = true;
  form.hidden = false;
  form.elements.name.focus();
});

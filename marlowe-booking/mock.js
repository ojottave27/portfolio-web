/* Mock de API para a demo estatica.
   A pagina original chamava /api/services, /api/slots, /api/book, /api/review e /api/reviews.
   Sem backend, este ficheiro intercepta o fetch e devolve dados plausiveis,
   mantendo a logica e o fluxo da pagina intactos. */

(function () {
  'use strict';

  var SERVICES = {
    advisory: { name: 'Advisory session', duration: 45, price: 90 },
    deep:     { name: 'Deep-dive review',  duration: 90, price: 165 },
    portfolio:{ name: 'Portfolio critique', duration: 60, price: 120 }
  };

  var REVIEWS = [
    { rating: 5, author: 'A. M.', service_name: 'Advisory session', text: 'Clear, direct, and genuinely useful. Left with a plan instead of a list of opinions.' },
    { rating: 5, author: 'J. R.', service_name: 'Portfolio critique', text: 'The review of my portfolio was blunt in the right way. Two weeks later I had three interviews.' },
    { rating: 4, author: 'S. K.', service_name: 'Deep-dive review', text: 'Good session. Would have liked a little more time, but the advice was specific and actionable.' }
  ];

  var booked = {};

  function jsonRes(obj, status) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  function slotsFor(date) {
    var base = ['09:00', '10:00', '11:30', '14:00', '15:30', '17:00'];
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var t = base[i];
      var key = date + ' ' + t;
      var taken = !!booked[key];
      var past = false;
      out.push({
        time: t,
        available: !taken && !past,
        reason: taken ? 'Already booked' : (past ? 'Too late to book' : '')
      });
    }
    return out;
  }

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = ((init && init.method) || 'GET').toUpperCase();

    // /api/services
    if (url.indexOf('/api/services') === 0) {
      return jsonRes({ services: SERVICES });
    }

    // /api/slots?date=YYYY-MM-DD
    if (url.indexOf('/api/slots') === 0) {
      var m = /date=([^&]+)/.exec(url);
      var date = m ? decodeURIComponent(m[1]) : '';
      return jsonRes({ slots: slotsFor(date) });
    }

    // /api/book (POST)
    if (url.indexOf('/api/book') === 0 && method === 'POST') {
      var body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) { body = {}; }

      if (!body.service || !SERVICES[body.service]) {
        return jsonRes({ error: 'Please choose a service.' }, 400);
      }
      if (!body.date || !body.time) {
        return jsonRes({ error: 'Please choose a date and time.' }, 400);
      }
      if (!body.name || !body.email) {
        return jsonRes({ error: 'Name and email are required.' }, 400);
      }
      if (!body.consent) {
        return jsonRes({ error: 'Please accept the data processing notice.' }, 400);
      }

      var key = body.date + ' ' + body.time;
      if (booked[key]) {
        return jsonRes({ error: 'That slot was just taken. Please pick another.' }, 409);
      }
      booked[key] = true;

      var id = 'BK' + String(Math.floor(Math.random() * 9000000) + 1000000);
      var svc = SERVICES[body.service];
      return jsonRes({
        booking_id: id,
        amount: svc.price,
        email_sent_to: body.email,
        payment_intent: 'pi_demo_' + id.toLowerCase()
      });
    }

    // /api/review (POST)
    if (url.indexOf('/api/review') === 0 && method === 'POST') {
      var b2 = {};
      try { b2 = JSON.parse(init.body || '{}'); } catch (e) { b2 = {}; }
      if (!b2.booking_id) {
        return jsonRes({ error: 'A valid booking ID is required.' }, 400);
      }
      return jsonRes({ ok: true, message: 'Review submitted for moderation.' });
    }

    // /api/reviews
    if (url.indexOf('/api/reviews') === 0) {
      return jsonRes({ reviews: REVIEWS });
    }

    // tudo o resto vai para a rede normal
    return realFetch(input, init);
  };
})();

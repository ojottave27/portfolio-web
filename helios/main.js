import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { startScene } from './scene.js';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = startScene(document.getElementById('scene'), { reduceMotion });
if (!scene) document.documentElement.classList.add('no-webgl');

const bar = document.querySelector('.progress-bar');
const nav = document.querySelector('nav');
ScrollTrigger.create({
  trigger: document.body,
  start: 'top top',
  end: 'bottom bottom',
  onUpdate(self) {
    bar.style.transform = `scaleX(${self.progress})`;
    if (!reduceMotion) scene?.setProgress(self.progress);
  },
});

// solid nav once the hero has scrolled away, so links never sit on top of copy
const updateNav = () => nav.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', updateNav, { passive: true });
updateNav();

// each camera chapter starts where its section reaches the middle of the screen
const chapterEls = {
  top: '#top',
  stats: '.stats',
  solutions: '#solutions',
  why: '#why',
  contact: '#contact',
};
function measureChapters() {
  if (!scene) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const anchors = {};
  for (const [name, selector] of Object.entries(chapterEls)) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.5;
    anchors[name] = Math.min(1, Math.max(0, y / max));
  }
  anchors.top = 0;
  scene.setAnchors(anchors);
}
measureChapters();
window.addEventListener('resize', measureChapters, { passive: true });
window.addEventListener('load', measureChapters);

// hovering a panel shows its datasheet, but never while the pointer is over content
const tip = document.querySelector('.panel-tip');
const CONTENT = 'a, button, input, textarea, select, label, h1, h2, h3, p, li, .card, .stat, .feature, form, .eyebrow';
if (scene && tip) {
  let last = null;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over?.closest(CONTENT)) {
      scene.setPointer(null);
    } else {
      scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    }
    last = e;
    placeTip();
  }, { passive: true });
  // keep the datasheet on screen: flip to the other side of the pointer near the edges.
  // Also called when the tip appears, since a hidden tip measures 0 wide.
  function placeTip() {
    if (!last || tip.hidden) return;
    let x = last.clientX + 18;
    let y = last.clientY + 18;
    if (x + tip.offsetWidth > window.innerWidth - 8) x = last.clientX - tip.offsetWidth - 18;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = last.clientY - tip.offsetHeight - 18;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  document.addEventListener('pointerleave', () => scene.setPointer(null));
  window.addEventListener('scroll', () => {
    if (last) scene.setPointer(null);
  }, { passive: true });
  scene.onHover((info) => {
    if (!info) {
      tip.hidden = true;
      return;
    }
    tip.querySelector('.tip-id').textContent = `Tracker T${info.tracker} · module ${info.module}`;
    tip.hidden = false;
    placeTip();
  });
}

if (!reduceMotion) {
  const ease = 'power3.out';
  gsap.from('.hero-inner > *', { y: 44, opacity: 0, duration: 1.2, ease, stagger: 0.11, delay: 0.12 });
  gsap.from('.marquee', { opacity: 0, duration: 0.9, ease: 'power2.out', delay: 0.7 });
  gsap.from('.stat', {
    y: 38, opacity: 0, duration: 0.95, ease, stagger: 0.11,
    scrollTrigger: { trigger: '.stats', start: 'top 88%' },
  });
  gsap.utils.toArray('.section-head').forEach((head) => {
    gsap.from(head.children, {
      y: 34, opacity: 0, duration: 1, ease, stagger: 0.1,
      scrollTrigger: { trigger: head, start: 'top 82%' },
    });
  });
  gsap.from('.card', {
    y: 50, opacity: 0, duration: 1.05, ease, stagger: 0.13,
    scrollTrigger: { trigger: '.cards', start: 'top 84%' },
  });
  gsap.from('.feature', {
    x: -24, opacity: 0, duration: 0.9, ease, stagger: 0.1,
    scrollTrigger: { trigger: '.features', start: 'top 85%' },
  });
  gsap.from(['.cta-copy > *', '.quote'], {
    y: 28, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.08,
    scrollTrigger: { trigger: '.cta-section', start: 'top 85%', once: true },
  });
}

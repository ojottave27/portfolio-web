import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { startScene } from './scene.js';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene = startScene(document.getElementById('scene'), { reduceMotion });
if (!scene) document.documentElement.classList.add('no-webgl');

const bar = document.querySelector('.progress-bar');
ScrollTrigger.create({
  trigger: document.body,
  start: 'top top',
  end: 'bottom bottom',
  onUpdate(self) {
    bar.style.transform = `scaleX(${self.progress})`;
    if (!reduceMotion) scene?.setProgress(self.progress);
  },
});

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

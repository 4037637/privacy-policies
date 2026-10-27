// Мышь не листает ряд сама, как палец: тянем его рукой, прилипание — после отпускания.
const shots = document.querySelector('.shots');
let drag = null;
shots.addEventListener('dragstart', (e) => e.preventDefault());
shots.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || shots.scrollWidth <= shots.clientWidth) return;
  drag = { x: e.clientX, left: shots.scrollLeft };
  shots.style.scrollSnapType = 'none';
  shots.style.cursor = 'grabbing';
  shots.setPointerCapture(e.pointerId);
});
shots.addEventListener('pointermove', (e) => {
  if (drag) shots.scrollLeft = drag.left - (e.clientX - drag.x);
});
const stop = () => {
  if (!drag) return;
  drag = null;
  shots.style.scrollSnapType = '';
  shots.style.cursor = '';
};
shots.addEventListener('pointerup', stop);
shots.addEventListener('pointercancel', stop);

// overlay.js
let isSelecting = false;
let startX = 0, startY = 0;

const shade   = document.getElementById('shade');
const sel     = document.getElementById('sel');
const stopBtn = document.getElementById('stop');

// ← listen for the hide‐shade event
window.api.onHideShade(() => {
  shade.style.display = 'none';
});

// Prevent Stop clicks from bubbling into the overlay
stopBtn.addEventListener('mousedown', e => e.stopPropagation());
stopBtn.addEventListener('mouseup',   e => e.stopPropagation());

// Begin drag
document.body.addEventListener('mousedown', e => {
  if (e.target === stopBtn) return;
  isSelecting = true;
  startX = e.clientX; startY = e.clientY;
  sel.style.left = `${startX}px`;
  sel.style.top  = `${startY}px`;
  sel.style.width = sel.style.height = '0px';
  sel.style.display = 'block';
  shade.style.display = 'block';
  document.body.style.cursor = 'crosshair';
});

// Resize drag box
document.body.addEventListener('mousemove', e => {
  if (!isSelecting) return;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  sel.style.left = `${x}px`; sel.style.top = `${y}px`;
  sel.style.width = `${w}px`; sel.style.height = `${h}px`;
});

// Finish drag
document.body.addEventListener('mouseup', e => {
  if (!isSelecting) return;
  isSelecting = false;
  shade.style.display = 'none';
  document.body.style.cursor = 'default';

  const rect = sel.getBoundingClientRect();
  
  // Make the button visible BEFORE calculating its position
  stopBtn.style.display = 'block';

  // Now calculate the position with the correct dimensions
  stopBtn.style.left  = `${rect.x + (rect.width - stopBtn.offsetWidth)/2}px`;
  stopBtn.style.top   = `${rect.y - stopBtn.offsetHeight - 8}px`;
  
  stopBtn.style.zIndex = '1000';

  window.api.selectDone({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  });
});

// Stop button
stopBtn.addEventListener('click', () => {
  // 1) Hide the Stop button immediately so it won’t be seen by FFmpeg
  stopBtn.style.display = 'none';

  // 2) Then tell main to stop recording
  window.api.stop();
});
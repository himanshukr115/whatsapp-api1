// public/js/app.js — FlowGram Client JS

(function loadChartJsIfNeeded() {
  if (typeof Chart === 'undefined') {
    const scriptEl = document.createElement('script');
    scriptEl.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    scriptEl.async = true;
    document.head.appendChild(scriptEl);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert').forEach((alertEl) => {
    setTimeout(() => {
      alertEl.style.transition = 'opacity 0.5s';
      alertEl.style.opacity = '0';
      setTimeout(() => alertEl.remove(), 500);
    }, 6000);
  });

  document.querySelectorAll('[data-confirm]').forEach((el) => {
    if (el.tagName === 'FORM') {
      el.addEventListener('submit', (event) => {
        if (!window.confirm(el.dataset.confirm)) event.preventDefault();
      });
      return;
    }

    el.addEventListener('click', (event) => {
      if (!window.confirm(el.dataset.confirm)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  });
});

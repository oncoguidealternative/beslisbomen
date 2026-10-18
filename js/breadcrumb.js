/* Generieke breadcrumb voor ieder zorgpad en iedere beslisboom. */
const Breadcrumb = (function () {
  'use strict';

  let carepathButton;
  let currentItem;
  let currentLabel;
  let onCarepathNavigate = function () {};

  function init(options) {
    const settings = options || {};

    carepathButton = document.getElementById('breadcrumb-carepath');
    currentItem = document.getElementById('breadcrumb-current-item');
    currentLabel = document.getElementById('breadcrumb-current');

    if (!carepathButton || !currentItem || !currentLabel) {
      console.warn('Breadcrumb: vereiste HTML-elementen ontbreken.');
      return;
    }

    onCarepathNavigate =
      typeof settings.onCarepathNavigate === 'function'
        ? settings.onCarepathNavigate
        : function () {};

    carepathButton.addEventListener('click', function () {
      onCarepathNavigate();
    });
  }

  function normalizeCarepathTitle(title) {
    const value = String(title || '').trim();

    if (!value) {
      return 'Zorgpad';
    }

    if (/^zorgpad\b/i.test(value)) {
      return value;
    }

    return 'Zorgpad ' + value;
  }

  function update(options) {
    if (!carepathButton || !currentItem || !currentLabel) {
      return;
    }

    const settings = options || {};
    const carepathTitle = normalizeCarepathTitle(
      settings.carepathTitle
    );
    const treeTitle = String(settings.treeTitle || '').trim();
    const isOverview = settings.isOverview !== false && !treeTitle;

    carepathButton.textContent = carepathTitle;
    carepathButton.setAttribute(
      'aria-label',
      isOverview
        ? carepathTitle
        : 'Terug naar ' + carepathTitle
    );

    if (isOverview) {
      currentLabel.textContent = '';
      currentItem.hidden = true;
      carepathButton.setAttribute('aria-current', 'page');
      carepathButton.classList.add('is-current');
    } else {
      currentLabel.textContent = treeTitle;
      currentItem.hidden = false;
      carepathButton.removeAttribute('aria-current');
      carepathButton.classList.remove('is-current');
    }
  }

  return {
    init: init,
    update: update
  };
})();

/* Rechter informatiepaneel voor JSON-pagina's uit data/pages/ (open) of voor meegegeven paginadata (showData). */
const ContentPanel = (function () {
  'use strict';

  let panel = null;
  let backdrop = null;
  let title = null;
  let meta = null;
  let body = null;
  let closeButton = null;
  let notice = null;
  let lastTrigger = null;
  let initialized = false;
  let activeRequest = 0;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function findElements() {
    panel = document.getElementById('content-panel');
    backdrop = document.getElementById('content-panel-backdrop');
    title = document.getElementById('content-panel-title');
    meta = document.getElementById('content-panel-meta');
    body = document.getElementById('content-panel-body');
    closeButton = document.getElementById('content-panel-close');

    return Boolean(panel && backdrop && title && meta && body && closeButton);
  }

  function setLoading() {
    if (notice) notice.hidden = true;
    title.textContent = 'Laden...';
    meta.textContent = '';
    body.replaceChildren(
      createElement('p', 'content-panel-status', 'De inhoud wordt geladen.')
    );
  }

  function setError(error) {
    console.error('Contentpagina laden mislukt:', error);
    title.textContent = 'Inhoud niet beschikbaar';
    meta.textContent = '';
    body.replaceChildren(
      createElement(
        'p',
        'content-panel-status',
        'Deze pagina kon niet worden geladen. Controleer of het JSON-bestand bestaat en geldig is.'
      )
    );
  }

  function appendLinks(container, links) {
    if (!Array.isArray(links) || links.length === 0) return;

    const wrapper = createElement('span', 'content-links');

    links.forEach(function (link) {
      const href = link.href || link.url || '';
      if (!href) return;

      const anchor = createElement(
        'a',
        'content-link',
        link.label || href
      );

      anchor.href = href;

      if (href.startsWith('mailto:')) {
        anchor.target = '_self';
      } else {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }

      wrapper.appendChild(anchor);
    });

    if (wrapper.childNodes.length > 0) container.appendChild(wrapper);
  }

  function appendParagraph(container, block) {
    const paragraph = createElement('p', 'content-paragraph');

    if (block.number) {
      paragraph.appendChild(
        createElement('strong', 'content-number', block.number + ' ')
      );
    }

    paragraph.appendChild(document.createTextNode(block.text || ''));
    appendLinks(paragraph, block.links);
    container.appendChild(paragraph);
  }

  function appendDefinitionList(container, block) {
    const list = createElement('dl', 'content-definition-list');

    (block.items || []).forEach(function (item) {
      list.appendChild(createElement('dt', null, item.term || ''));
      list.appendChild(createElement('dd', null, item.definition || ''));
    });

    container.appendChild(list);
  }

  function appendGroupedList(container, block) {
    const wrapper = createElement('div', 'content-grouped-list');

    if (block.number || block.intro) {
      const intro = createElement('p', 'content-paragraph');

      if (block.number) {
        intro.appendChild(
          createElement('strong', 'content-number', block.number + ' ')
        );
      }

      intro.appendChild(document.createTextNode(block.intro || ''));
      wrapper.appendChild(intro);
    }

    (block.groups || []).forEach(function (group) {
      if (group.title) wrapper.appendChild(createElement('h4', null, group.title));

      const list = createElement('ul');
      (group.items || []).forEach(function (item) {
        list.appendChild(createElement('li', null, item));
      });
      wrapper.appendChild(list);
    });

    container.appendChild(wrapper);
  }

  function renderBlock(container, block) {
    if (!block || !block.type) return;

    if (block.type === 'paragraph') {
      appendParagraph(container, block);
    } else if (block.type === 'definitionList') {
      appendDefinitionList(container, block);
    } else if (block.type === 'groupedList') {
      appendGroupedList(container, block);
    } else {
      console.warn('ContentPanel: onbekend bloktype:', block.type);
    }
  }

  /* Vaste melding tussen de kop en de inhoud (bv. de disclaimer bij bron en onderbouwing).
     data.notice: { before, linkText, href, after }; zonder href wordt linkText gewone tekst. */
  function renderNotice(data) {
    if (!notice) {
      notice = createElement('div', 'content-panel-notice');
      body.parentNode.insertBefore(notice, body);
    }
    const n = data.notice;
    notice.replaceChildren();
    notice.hidden = !n;
    if (!n) return;
    notice.appendChild(document.createTextNode(n.before || ''));
    if (n.linkText) {
      if (n.href && /^https?:\/\//i.test(n.href)) {
        const a = createElement('a', 'content-link', n.linkText);
        a.href = n.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        notice.appendChild(a);
      } else {
        notice.appendChild(document.createTextNode(n.linkText));
      }
    }
    notice.appendChild(document.createTextNode(n.after || ''));
  }

  function render(data) {
    title.textContent = data.title || 'Informatie';
    meta.textContent = data.meta || (data.version ? 'Versie: ' + data.version : '');
    renderNotice(data);
    body.replaceChildren();

    (data.sections || []).forEach(function (section) {
      const sectionElement = createElement('section', 'content-section');
      const headingText = [section.number, section.title]
        .filter(Boolean)
        .join('. ');

      if (headingText) {
        sectionElement.appendChild(createElement('h3', null, headingText));
      }

      (section.blocks || []).forEach(function (block) {
        renderBlock(sectionElement, block);
      });

      body.appendChild(sectionElement);
    });
  }

  function show() {
    backdrop.hidden = false;
    panel.hidden = false;
    document.body.classList.add('content-panel-is-open');

    requestAnimationFrame(function () {
      backdrop.classList.add('is-open');
      panel.classList.add('is-open');
    });

    closeButton.focus();
  }

  function close() {
    if (!panel || panel.hidden) return;

    activeRequest += 1;
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('content-panel-is-open');

    window.setTimeout(function () {
      panel.hidden = true;
      backdrop.hidden = true;

      if (lastTrigger && document.contains(lastTrigger)) {
        lastTrigger.focus();
      }
    }, 260);
  }

  async function open(pageId, trigger) {
    if (!initialized) init();
    if (!panel || !pageId) return;

    lastTrigger = trigger || document.activeElement;
    const requestId = ++activeRequest;

    setLoading();
    show();

    try {
      const response = await fetch(
        './data/pages/' + encodeURIComponent(pageId) + '.json'
      );

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const data = await response.json();
      if (requestId !== activeRequest) return;

      render(data);
      body.scrollTop = 0;
    } catch (error) {
      if (requestId === activeRequest) setError(error);
    }
  }

  /* Toont kant-en-klare paginadata (zelfde opbouw als data/pages/*.json) zonder iets op te halen.
     Gebruikt voor inhoud die uit het zorgpad zelf komt, zoals de bronvermelding. */
  function showData(data, trigger) {
    if (!initialized) init();
    if (!panel || !data) return;
    lastTrigger = trigger || document.activeElement;
    activeRequest += 1;
    render(data);
    show();
    body.scrollTop = 0;
  }

  function handleDocumentClick(event) {
    const trigger = event.target.closest('[data-content-page]');
    if (!trigger) return;

    event.preventDefault();
    open(trigger.dataset.contentPage, trigger);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && panel && !panel.hidden) close();
  }

  function init() {
    if (initialized) return;

    if (!findElements()) {
      console.warn('ContentPanel: vereiste HTML-elementen ontbreken.');
      return;
    }

    initialized = true;
    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
  }

  return {
    init: init,
    open: open,
    showData: showData,
    close: close
  };
})();

/* Het paneel initialiseert zichzelf, zodat footerlinks ook werken als de pagina ContentPanel.init() niet aanroept.
   init() is idempotent: een tweede aanroep (bijvoorbeeld vanuit de HTML) doet niets. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { ContentPanel.init(); });
} else {
  ContentPanel.init();
}

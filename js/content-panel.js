/* Generiek uitschuifbaar contentpaneel voor JSON-pagina's uit data/pages/. */
const ContentPanel = (function () {
  'use strict';

  let panel;
  let backdrop;
  let title;
  let meta;
  let body;
  let closeButton;
  let lastTrigger = null;
  let initialized = false;
  let activeRequest = 0;

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function ensureElements() {
    panel = document.getElementById('content-panel');
    backdrop = document.getElementById('content-panel-backdrop');
    title = document.getElementById('content-panel-title');
    meta = document.getElementById('content-panel-meta');
    body = document.getElementById('content-panel-body');
    closeButton = document.getElementById('content-panel-close');

    return Boolean(panel && backdrop && title && meta && body && closeButton);
  }

  function setLoading() {
    title.textContent = 'Laden...';
    meta.textContent = '';
    body.replaceChildren(createElement('p', 'content-panel-status', 'De inhoud wordt geladen.'));
  }

  function setError() {
    title.textContent = 'Inhoud niet beschikbaar';
    meta.textContent = '';
    body.replaceChildren(
      createElement('p', 'content-panel-status', 'Deze pagina kon niet worden geladen. Controleer of het JSON-bestand bestaat en geldig is.')
    );
  }

  function appendParagraph(container, block) {
    const paragraph = createElement('p', 'content-paragraph');

    if (block.number) {
      const number = createElement('strong', 'content-number', block.number + ' ');
      paragraph.appendChild(number);
    }

    paragraph.appendChild(document.createTextNode(block.text || ''));

    if (Array.isArray(block.links) && block.links.length) {
      const links = createElement('span', 'content-links');
      block.links.forEach(function (link) {
        const anchor = createElement('a', 'content-link', link.label || link.href);
        anchor.href = link.href;
        anchor.target = link.href && link.href.startsWith('mailto:') ? '_self' : '_blank';
        if (anchor.target === '_blank') anchor.rel = 'noopener noreferrer';
        links.appendChild(anchor);
      });
      paragraph.appendChild(links);
    }

    container.appendChild(paragraph);
  }

  function appendDefinitionList(container, block) {
    const list = createElement('dl', 'content-definition-list');
    (block.items || []).forEach(function (item) {
      list.appendChild(createElement('dt', null, item.term));
      list.appendChild(createElement('dd', null, item.definition));
    });
    container.appendChild(list);
  }

  function appendGroupedList(container, block) {
    const wrapper = createElement('div', 'content-grouped-list');

    if (block.number || block.intro) {
      const intro = createElement('p', 'content-paragraph');
      if (block.number) intro.appendChild(createElement('strong', 'content-number', block.number + ' '));
      intro.appendChild(document.createTextNode(block.intro || ''));
      wrapper.appendChild(intro);
    }

    (block.groups || []).forEach(function (group) {
      wrapper.appendChild(createElement('h4', null, group.title));
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

    if (block.type === 'paragraph') appendParagraph(container, block);
    else if (block.type === 'definitionList') appendDefinitionList(container, block);
    else if (block.type === 'groupedList') appendGroupedList(container, block);
  }

  function render(data) {
    title.textContent = data.title || 'Informatie';
    meta.textContent = data.version ? 'Versie: ' + data.version : '';
    body.replaceChildren();

    (data.sections || []).forEach(function (section) {
      const sectionElement = createElement('section', 'content-section');
      const headingText = [section.number, section.title].filter(Boolean).join('. ');
      sectionElement.appendChild(createElement('h3', null, headingText));
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
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('content-panel-is-open');

    window.setTimeout(function () {
      panel.hidden = true;
      backdrop.hidden = true;
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    }, 260);
  }

  async function open(pageId, trigger) {
    if (!initialized) init();
    if (!panel) return;

    lastTrigger = trigger || document.activeElement;
    const requestId = ++activeRequest;
    setLoading();
    show();

    try {
      const response = await fetch('./data/pages/' + encodeURIComponent(pageId) + '.json');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (requestId !== activeRequest) return;
      render(data);
      body.scrollTop = 0;
    } catch (error) {
      console.error('Contentpagina laden mislukt:', error);
      if (requestId === activeRequest) setError();
    }
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
    initialized = true;

    if (!ensureElements()) {
      console.warn('ContentPanel: vereiste HTML-elementen ontbreken.');
      return;
    }

    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
  }

  return {
    init: init,
    open: open,
    close: close
  };
})();

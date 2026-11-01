(function (Q) {
  'use strict';
  const U = Q.util;
  const UI = Q.ui;
  const AI = Q.ai;
  const h = U.h;

  // The small subset of Markdown the models write, shown as plain text and never as HTML.
  function renderAnswer(el, text) {
    U.clear(el);
    for (const raw of AI.withoutLaTeX(text).split('\n')) {
      const line = raw.trim();
      if (!line) {
        el.appendChild(h('div', { class: 'ai-gap' }));
        continue;
      }
      const row = h('div', { class: 'ai-line' });
      let body = line;
      if (body.startsWith('#')) {
        row.classList.add('ai-head');
        body = body.replace(/^#+\s*/, '');
      } else if (/^[-*] /.test(body)) {
        row.classList.add('ai-bullet');
        body = '•  ' + body.slice(2);
      }
      body.split(/\*\*/).forEach((part, i) => {
        if (part) row.appendChild(i % 2 ? h('strong', null, part) : document.createTextNode(part));
      });
      el.appendChild(row);
    }
  }

  function friendly(e) {
    return (e && e.message) || 'Something went wrong. Try again.';
  }

  function mainButton(label, onClick) {
    return h('button', { class: 'btn primary', onclick: onClick }, label);
  }

  class Study {
    constructor(editor) {
      this.editor = editor;
      this.cache = new Map();
      this.tab = 'chat';
      this.chat = [];
      this.panel = h('div', { class: 'ai-panel' });
      this.notice = h('div', { class: 'ai-notice', hidden: true });
      const tabs = UI.seg(
        [
          { value: 'chat', label: 'Chat' },
          { value: 'summary', label: 'Summary' },
          { value: 'points', label: 'Key points' },
          { value: 'cards', label: 'Cards' },
          { value: 'quiz', label: 'Quiz' },
          { value: 'map', label: 'Mind map' },
          { value: 'teach', label: 'Teach back' },
        ],
        this.tab,
        (tab) => this.show(tab),
        { small: true, wrap: true }
      );
      this.sheet = UI.sheet({
        title: 'Study',
        wide: true,
        className: 'ai-sheet',
        body: h('div', { class: 'ai-study' }, tabs, this.notice, this.panel),
        onClose: () => this.stop(),
      });
      this.show(this.tab);
    }

    stop() {
      if (this.running) this.running.abort();
      this.running = null;
    }

    start() {
      this.stop();
      this.running = new AbortController();
      return this.running.signal;
    }

    async pages(signal) {
      const { pages, inkFailed } = await AI.pageTexts(this.editor.pages, signal);
      this.notice.hidden = !inkFailed;
      this.notice.textContent = inkFailed ? 'Your handwriting couldn’t be read right now, so only typed text and PDF text are used. Connect to the internet once so the handwriting reader can download.' : '';
      return pages;
    }

    async noteText(signal) {
      const text = (await this.pages(signal)).filter(Boolean).join('\n\n');
      if (!text.trim()) throw new Error('This notebook has nothing to read yet. Write or type something first.');
      return text;
    }

    show(tab) {
      this.stop();
      this.tab = tab;
      U.clear(this.panel);
      if (!AI.isAvailable()) {
        this.panel.append(
          h('p', { class: 'ai-empty' }, 'Add a free NVIDIA API key, or download the writing model to run it on this device.'),
          mainButton('Open AI settings', () => openSettings(() => this.show(this.tab)))
        );
        return;
      }
      ({ chat: this.showChat, summary: () => this.showText('Summarize this notebook.', AI.summary), points: () => this.showText('List the key points and action items.', AI.keyPoints), cards: this.showCards, quiz: this.showQuiz, map: this.showMap, teach: this.showTeach })[tab].call(this);
    }

    // The shared flow for anything that takes a while: a stop button, progress, then a result or a clear error.
    async run(area, work) {
      const signal = this.start();
      const status = h('div', { class: 'ai-status' }, 'Working…');
      const stop = h('button', { class: 'btn sm', onclick: () => this.stop() }, 'Stop');
      const bar = h('div', { class: 'ai-working' }, status, stop);
      area.prepend(bar);
      try {
        return await work(signal, (message) => (status.textContent = message));
      } catch (e) {
        if (e.name !== 'AbortError') area.appendChild(h('p', { class: 'ai-error', role: 'alert' }, friendly(e)));
        return null;
      } finally {
        bar.remove();
      }
    }

    progress(say, signal, extra) {
      return Object.assign({ signal, cache: this.cache, onProgress: (i, n) => say(`Reading part ${i + 1} of ${n}…`) }, extra);
    }

    showText(lead, fn) {
      const output = h('div', { class: 'ai-answer' });
      const area = h('div', { class: 'ai-area' }, output);
      const go = async () => {
        U.clear(output);
        button.disabled = true;
        const text = await this.run(area, async (signal, say) => fn(await this.noteText(signal), this.progress(say, signal, { onPartial: (t) => renderAnswer(output, t) })));
        button.disabled = false;
        if (text) renderAnswer(output, text);
      };
      const button = mainButton('Generate', go);
      this.panel.append(h('div', { class: 'ai-row' }, h('p', { class: 'ai-lead' }, lead), button), area);
    }

    showChat() {
      const list = h('div', { class: 'ai-chat', 'aria-live': 'polite' });
      const area = h('div', { class: 'ai-area' }, list);
      const draw = () => {
        U.clear(list);
        if (!this.chat.length) list.appendChild(h('p', { class: 'ai-empty' }, 'Ask anything about this notebook. The right pages are found first, so this works on long books too.'));
        for (const m of this.chat) {
          const bubble = h('div', { class: 'ai-msg ' + m.role });
          renderAnswer(bubble, m.text);
          list.appendChild(bubble);
        }
        list.scrollTop = list.scrollHeight;
      };
      const input = h('textarea', { class: 'field ai-input', rows: 2, placeholder: 'Ask about these notes', 'aria-label': 'Question' });
      const send = async () => {
        const question = input.value.trim();
        if (!question || this.busy) return;
        input.value = '';
        this.chat.push({ role: 'user', text: question });
        draw();
        this.busy = true;
        const answer = { role: 'assistant', text: '' };
        await this.run(area, async (signal) => {
          const pages = await this.pages(signal);
          // A follow-up like "why does it happen?" says nothing of its subject, so the question before it searches too.
          const recent = this.chat.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
          const asked = this.chat.slice(-5).filter((m) => m.text);
          this.chat.push(answer);
          answer.text = await AI.complete(AI.chatSystem(AI.chatContext(pages, recent)), asked, {
            signal,
            onPartial: (t) => {
              answer.text = t;
              draw();
            },
          });
          draw();
        });
        // What was already written of the answer stays, as when stopping any other reply.
        if (!answer.text && this.chat[this.chat.length - 1] === answer) this.chat.pop();
        this.busy = false;
        draw();
      };
      draw();
      this.panel.append(area, h('div', { class: 'ai-compose' }, input, mainButton('Ask', send)));
    }

    showCards() {
      const area = h('div', { class: 'ai-area' });
      const go = async () => {
        U.clear(area);
        const cards = await this.run(area, async (signal, say) => AI.flashcards(await this.noteText(signal), this.progress(say, signal)));
        if (!cards) return;
        let index = 0, flipped = false;
        const face = h('button', { class: 'ai-card', 'aria-live': 'polite' });
        const count = h('span', { class: 'ai-count' });
        const draw = () => {
          face.textContent = flipped ? cards[index].back : cards[index].front;
          face.classList.toggle('back', flipped);
          count.textContent = `${index + 1} of ${cards.length}`;
        };
        face.onclick = () => {
          flipped = !flipped;
          draw();
        };
        const move = (d) => {
          index = (index + d + cards.length) % cards.length;
          flipped = false;
          draw();
        };
        draw();
        area.append(face, h('div', { class: 'ai-row' }, h('button', { class: 'btn', onclick: () => move(-1) }, 'Previous'), count, h('button', { class: 'btn', onclick: () => move(1) }, 'Next')));
      };
      this.panel.append(h('div', { class: 'ai-row' }, h('p', { class: 'ai-lead' }, 'Make flashcards from this notebook. Tap a card to turn it over.'), mainButton('Generate', go)), area);
    }

    showQuiz() {
      const area = h('div', { class: 'ai-area' });
      const go = async () => {
        U.clear(area);
        const questions = await this.run(area, async (signal, say) => AI.quiz(await this.noteText(signal), this.progress(say, signal)));
        if (!questions) return;
        let right = 0, answered = 0;
        const score = h('p', { class: 'ai-lead', 'aria-live': 'polite' });
        questions.forEach((q, n) => {
          const options = q.options.map((option, i) =>
            h('button', {
              class: 'ai-option',
              onclick: () => {
                options.forEach((b, j) => {
                  b.disabled = true;
                  if (j === q.answer) b.classList.add('right');
                });
                if (i !== q.answer) options[i].classList.add('wrong');
                else right++;
                answered++;
                if (answered === questions.length) score.textContent = `You got ${right} of ${questions.length} right.`;
              },
            }, option)
          );
          area.appendChild(h('div', { class: 'ai-question' }, h('p', { class: 'ai-q' }, `${n + 1}. ${q.question}`), ...options));
        });
        area.appendChild(score);
      };
      this.panel.append(h('div', { class: 'ai-row' }, h('p', { class: 'ai-lead' }, 'Test yourself with a multiple-choice quiz on this notebook.'), mainButton('Generate', go)), area);
    }

    showMap() {
      const area = h('div', { class: 'ai-area' });
      const branch = (node) => {
        const item = h('li', null, h('span', { class: 'ai-node' }, String(node.title)));
        if (Array.isArray(node.children) && node.children.length) item.appendChild(h('ul', null, ...node.children.filter((c) => c && c.title).map(branch)));
        return item;
      };
      const go = async () => {
        U.clear(area);
        const root = await this.run(area, async (signal, say) => AI.mindMap(await this.noteText(signal), this.progress(say, signal)));
        if (root) area.appendChild(h('ul', { class: 'ai-map' }, branch(root)));
      };
      this.panel.append(h('div', { class: 'ai-row' }, h('p', { class: 'ai-lead' }, 'See how the ideas in this notebook connect.'), mainButton('Generate', go)), area);
    }

    showTeach() {
      const output = h('div', { class: 'ai-answer' });
      const area = h('div', { class: 'ai-area' }, output);
      const input = h('textarea', { class: 'field ai-input', rows: 4, placeholder: 'Explain a topic in your own words', 'aria-label': 'Your explanation' });
      const go = async () => {
        const said = input.value.trim();
        if (!said) return;
        U.clear(output);
        const text = await this.run(area, async (signal) => AI.reviewExplanation(said, AI.chatContext(await this.pages(signal), said), { signal, onPartial: (t) => renderAnswer(output, t) }));
        if (text) renderAnswer(output, text);
      };
      this.panel.append(h('p', { class: 'ai-lead' }, 'Explain a topic from this notebook in your own words, and see what’s missing.'), input, h('div', { class: 'ai-row end' }, mainButton('Check', go)), area);
    }
  }

  Q.Editor.prototype.openStudy = function () {
    return new Study(this);
  };

  function keySection(onChange) {
    const status = h('p', { class: 'set-hint', 'aria-live': 'polite' });
    const input = h('input', { class: 'field', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'nvapi-…', 'aria-label': 'NVIDIA API key' });
    const remove = h('button', { class: 'btn sm', onclick: () => {
      AI.setKey('');
      input.value = '';
      status.textContent = 'Key removed.';
      draw();
      onChange();
    } }, 'Remove');
    const save = h('button', { class: 'btn sm primary', onclick: async () => {
      if (!input.value.trim()) return;
      AI.setKey(input.value);
      input.value = '';
      draw();
      onChange();
      status.textContent = 'Checking the key…';
      try {
        status.textContent = `Connected. ${await AI.checkKey()} will answer.`;
      } catch (e) {
        status.textContent = friendly(e);
      }
    } }, 'Save key');
    const draw = () => {
      remove.hidden = !AI.hasKey();
      input.placeholder = AI.hasKey() ? 'A key is saved. Enter a new one to replace it.' : 'nvapi-…';
    };
    draw();
    return h('div', { class: 'ai-setting' },
      h('h3', null, 'Online AI'),
      h('p', { class: 'set-hint' }, 'With a free API key from build.nvidia.com, study tools use a large model on NVIDIA’s servers, so the notes they work on are sent there. The key is stored encrypted on this device.'),
      input,
      h('div', { class: 'ai-row' }, save, remove),
      status
    );
  }

  function modelSection(onChange) {
    const status = h('p', { class: 'set-hint', 'aria-live': 'polite' });
    const actions = h('div', { class: 'ai-row' });
    const draw = () => {
      const m = AI.modelState();
      U.clear(actions);
      if (m.downloading) {
        status.textContent = `Downloading… ${U.fmtBytes(m.done)} of ${U.fmtBytes(m.total)}. Keep the app open.`;
        actions.appendChild(h('button', { class: 'btn sm', onclick: () => AI.cancelDownload() }, 'Stop'));
      } else if (m.installed) {
        status.textContent = m.enoughMemory ? 'Installed. It answers when there’s no key or no connection, and nothing leaves this device.' : 'Installed, but this device doesn’t have enough memory to run it.';
        actions.appendChild(h('button', { class: 'btn sm danger', onclick: () => {
          AI.deleteModel();
          draw();
          onChange();
        } }, 'Delete model'));
      } else {
        const partial = m.done > 0 ? ` ${U.fmtBytes(m.done)} downloaded so far.` : '';
        status.textContent = m.problem || (m.enoughMemory ? `Runs on this device with no key or connection. A ${U.fmtBytes(m.total)} download, best on Wi-Fi. Answers are slower than online.${partial}` : 'This device doesn’t have enough memory to run the writing model. It needs about 4 GB.');
        if (m.enoughMemory) actions.appendChild(h('button', { class: 'btn sm primary', onclick: () => AI.download() }, m.done > 0 ? 'Continue download' : 'Download model'));
      }
    };
    draw();
    const off = AI.onModelChange(() => {
      draw();
      onChange();
    });
    return { el: h('div', { class: 'ai-setting' }, h('h3', null, 'On-device AI'), status, actions), close: off };
  }

  function openSettings(onChange = () => {}) {
    const model = modelSection(onChange);
    UI.sheet({
      title: 'AI settings',
      className: 'ai-sheet',
      body: h('div', { class: 'ai-settings' }, keySection(onChange), model.el),
      onClose: () => {
        model.close();
        onChange();
      },
    });
  }
  Q.study = { openSettings };
})((window.Q = window.Q || {}));

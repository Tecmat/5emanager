// @vitest-environment jsdom
/**
 * Test polish UI (v0.1.61): onboarding primo avvio, palette comandi Ctrl+K, skeleton.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!(window as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const pageErrors: string[] = [];
window.addEventListener('error', (e) => pageErrors.push(e.message));
window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e as PromiseRejectionEvent).reason)));

async function flush(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickButton(container: HTMLElement, re: RegExp): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((x) => re.test(x.textContent ?? ''));
  expect(b, `pulsante ${re} presente`).toBeTruthy();
  return b!;
}

async function mountApp() {
  const { StoreProvider } = await import('../src/store.js');
  const { NetProvider } = await import('../src/netStore.js');
  const App = (await import('../src/App.js')).default;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <StoreProvider>
        <NetProvider>
          <App />
        </NetProvider>
      </StoreProvider>,
    );
  });
  await flush(150);
  return { container, root };
}

describe('polish UI: onboarding + palette', () => {
  it('primo avvio senza schede: mostra l\'onboarding; "Salta" lo chiude e lo memorizza', async () => {
    localStorage.clear();
    const { container, root } = await mountApp();
    // onboarding visibile
    expect(container.textContent).toContain('Crea il tuo primo personaggio');
    expect(container.textContent).toContain('Passo 1 di 3');
    await act(async () => {
      clickButton(container, /Salta/).click();
    });
    await flush(80);
    expect(container.textContent).not.toContain('Passo 1 di 3');
    expect(localStorage.getItem('dnd5e.onboarded.v1')).toBe('1');
    // home raggiungibile: pulsante "Nuova scheda"
    expect([...container.querySelectorAll('button')].some((b) => /Nuova scheda/.test(b.textContent ?? ''))).toBe(true);
    expect(pageErrors).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });

  it('onboarding completo in 3 passi crea la scheda senza errori', async () => {
    localStorage.clear();
    const { container, root } = await mountApp();
    expect(container.textContent).toContain('Passo 1 di 3');
    // passo 1: nome
    const nameInput = container.querySelector('.modal-bg input') as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    await act(async () => {
      setInput(nameInput!, 'Onboarding Ero');
    });
    await act(async () => {
      clickButton(container, /Avanti/).click();
    });
    await flush(60);
    expect(container.textContent).toContain('Passo 2 di 3');
    // passo 2: array standard -> avanti
    await act(async () => {
      clickButton(container, /Avanti/).click();
    });
    await flush(60);
    expect(container.textContent).toContain('Passo 3 di 3');
    expect(container.textContent).toContain('Onboarding Ero');
    await act(async () => {
      clickButton(container, /Crea il personaggio/).click();
    });
    await flush(300);
    // scheda creata: nome in header, onboarding sparito, nessun errore
    expect(container.textContent).toContain('Onboarding Ero');
    expect(container.textContent).not.toContain('Passo 1 di 3');
    expect(localStorage.getItem('dnd5e.onboarded.v1')).toBe('1');
    expect(pageErrors).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });

  it('Ctrl+K apre la palette, il filtro restringe i comandi e Invio esegue la navigazione', async () => {
    localStorage.clear();
    localStorage.setItem('dnd5e.onboarded.v1', '1');
    const { container, root } = await mountApp();
    // apre con Ctrl+K
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });
    await flush(60);
    const input = container.querySelector('.modal-bg input') as HTMLInputElement | null;
    expect(input, 'palette aperta con input di ricerca').toBeTruthy();
    expect(/comando/i.test(input!.placeholder)).toBe(true);
    // filtra "campagna"
    await act(async () => {
      setInput(input!, 'campagna');
    });
    await flush(60);
    const items = [...container.querySelectorAll('.cmdk-item')];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((el) => /campagna/i.test(el.textContent ?? ''))).toBe(true);
    // Invio sul primo risultato -> pagina campagna attiva
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush(200);
    expect(container.querySelector('.modal-bg')).toBeNull(); // palette chiusa
    const navActive = container.querySelector('nav.tabs button.active');
    expect((navActive?.textContent ?? '')).toMatch(/Campagna/);
    expect(pageErrors).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });
});

// @vitest-environment jsdom
/**
 * Test di fumo UI: monta l'app, crea una scheda e verifica che non ci sia crash
 * (regressione "schermo nero" dopo la creazione della scheda su desktop).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

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

describe('App: montaje + creazione scheda (no crash)', () => {
  it('monta, crea una scheda e mostra la pagina scheda senza errori', async () => {
    localStorage.setItem('dnd5e.onboarded.v1', '1'); // salta l'onboarding: qui testiamo il form
    const { StoreProvider } = await import('../src/store.js');
    const { NetProvider } = await import('../src/netStore.js');
    const App = (await import('../src/App.js')).default;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
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

    // home → "Nuova scheda"
    const newBtn = [...container.querySelectorAll('button')].find((b) => /Nuova scheda|New sheet/.test(b.textContent ?? ''));
    expect(newBtn, 'pulsante Nuova scheda presente').toBeTruthy();
    await act(async () => {
      newBtn!.click();
    });
    await flush(80);

    // form: nome + crea
    const nameInput = container.querySelector('input') as HTMLInputElement | null;
    expect(nameInput, 'form di creazione apparso').toBeTruthy();
    await act(async () => {
      setInput(nameInput!, 'Test Ero');
    });
    const createBtn = [...container.querySelectorAll('button')].find((b) => /Crea personaggio|Create character/.test(b.textContent ?? ''));
    expect(createBtn, 'pulsante Crea personaggio presente').toBeTruthy();
    await act(async () => {
      createBtn!.click();
    });
    await flush(300);

    // dopo la creazione: pagina scheda, tab presenti, nessun boundary di errore
    expect(container.innerHTML).not.toContain('Errore imprevisto');
    expect(container.textContent).toContain('Test Ero');
    expect(pageErrors).toEqual([]);

    // cambio tab scheda (incantesimi/inventario/combattimento) — lazy chunk
    for (const label of ['Incantesimi', 'Inventario', 'Combattimento']) {
      const tab = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
      if (tab) {
        await act(async () => {
          tab.click();
        });
        await flush(120);
      }
    }
    expect(container.innerHTML).not.toContain('Errore imprevisto');
    expect(pageErrors).toEqual([]);

    root.unmount();
  });
});

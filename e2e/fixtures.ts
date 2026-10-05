import { expect } from 'e2e';
import type { Browser } from '@e2e-dev/web';

export const games = ['pinpoint', 'crossclimb', 'mini-sudoku', 'queens', 'tango', 'zip', 'patches', 'wend'] as const;
export type Game = typeof games[number];
const ids: Record<Game, string> = { pinpoint: '1', crossclimb: '2', 'mini-sudoku': '7', queens: '3', tango: '5', zip: '6', patches: '8', wend: '4' };
const selectors: Record<Game, string> = { pinpoint: '<input aria-label="Guess the category...">',
  crossclimb: '<div class="crossclimb-board"><button>Check</button></div>',
  'mini-sudoku': '<div class="sudoku-grid"><button>Check</button></div>',
  queens: '<div id="queens-game-board">Queens board</div>', tango: '<div id="tango-cell-0">Tango board</div>',
  zip: '<div data-cell-idx="0">Zip board</div>', patches: '<div data-cell-idx="0">Patches board</div>',
  wend: '<div data-game-content-root>Wend board</div>' };
const boardKeys: Partial<Record<Game, string>> = { queens: 'queensBoardStateBinding', tango: 'tangoBoardStateBinding',
  zip: 'zipGamePathBinding', patches: 'patchesBoardStateBinding', wend: 'wendBoardStateBinding' };
const boards: Partial<Record<Game, string[]>> = { queens: ['QUEEN', 'EMPTY', 'EMPTY', 'QUEEN'],
  tango: ['ZERO', 'ONE', 'ONE', 'ZERO'], zip: ['0', '1', '3', '2'], patches: ['0_1', '2_3'], wend: ['0_1', '2_3'] };
const puzzles: Record<Game, unknown> = {
  pinpoint: { pinpointGamePuzzle: { solution: 'Fruits' } },
  crossclimb: { crossClimbGamePuzzle: { rungs: [{ solutionRungIndex: 2, clue: 'Animal', word: 'CATS' },
    { solutionRungIndex: 0, clue: 'Headwear', word: 'HATS' }, { solutionRungIndex: 1, clue: 'Rodents', word: 'RATS' }] } },
  'mini-sudoku': { miniSudokuGamePuzzle: { gridRowSize: 2, gridColSize: 2, solution: [1, 2, 2, 1], presetCellIdxes: [0, 3] } },
  queens: { queensGamePuzzle: { gridSize: 7, solution: [{ row: 0, col: 5 }, { row: 1, col: 2 },
    { row: 2, col: 4 }, { row: 3, col: 6 }, { row: 4, col: 0 }, { row: 5, col: 3 }, { row: 6, col: 1 }] } },
  tango: { lotkaGamePuzzle: { gridSize: 2, solution: ['LotkaCellValue_ZERO', 'LotkaCellValue_ONE', 'LotkaCellValue_ONE', 'LotkaCellValue_ZERO'] } },
  zip: { trailGamePuzzle: { gridSize: 2, solution: [0, 1, 3, 2] } },
  patches: { patchesGamePuzzle: { gridRows: 2, gridCols: 2, solution: [{ cellIdxes: [0, 1] }, { cellIdxes: [2, 3] }] } },
  wend: { wendGamePuzzle: { puzzleLetters: ['C', 'A', 'T', 'S'], solutionWords: [{ sequencingIndex: [0, 1] }, { sequencingIndex: [2, 3] }] } },
};

function template(game: Game) {
  const states = [{ key: 'gameBoardPuzzleId', value: { type: 'bigint', value: '-999' } },
    { key: 'gameBoardHasWon', value: false }, { key: boardKeys[game], value: [] },
    { key: 'gameBoardTimeElapsed', value: { type: 'bigint', value: '14625' } },
    { key: 'gameIsTutorialGameBinding', value: true }, { key: 'fixtureUnrelatedBinding', value: 'preserve-me' }];
  return { requestId: 'updateGameState', csrfToken: 'fixture-secret', states,
    requestedArguments: { payload: { gameTypeId: ids[game] }, states: structuredClone(states) } };
}

export async function fixture(browser: Browser, game: Game, options: {
  guest?: boolean; hiddenResults?: boolean; hiddenFrame?: boolean; brokenNative?: boolean; staleContract?: boolean;
  mode?: 'http-error' | 'wrong-resource' | 'no-persistence';
} = {}) {
  let saved = false, saves = 0, initialSaves = 0, navigations = 0;
  const urn = `urn:li:fsd_game:(fixture-member,${ids[game]},-999)`;
  if (!options.guest) await browser.setCookies([
    { name: 'li_at', value: 'offline-only', url: 'https://www.linkedin.com', secure: true, httpOnly: true },
    { name: 'JSESSIONID', value: '"ajax:123"', url: 'https://www.linkedin.com', secure: true },
  ]);
  await browser.route('**/*', async route => {
    const { url, method, postData } = route.request;
    if (new URL(url).origin !== 'https://www.linkedin.com') return route.abort();
    if (method === 'POST' && /\/voyager\/api\/graphql/.test(url)) {
      const body = JSON.parse(postData!);
      const record = body.variables.entity.entity.gameStoredRecord;
      expect(body.variables.entity.resourceKey).toBe(urn);
      expect(record.gamePlayState).toBe('END_SOLVED');
      expect(route.request.headers['csrf-token']).toBe('ajax:123');
      if (game === 'pinpoint') expect(record.gameStateUnion).toEqual({ blueprintGameState: ['Fruits'] });
      if (game === 'crossclimb') {
        expect(record.gameStateUnion.crossClimbGameState.map((r: any) => r.word)).toEqual(['hats', 'rats', 'cats']);
        expect(record.gameStateUnion.crossClimbGameState[0].guess).toBe('H&-*A&-*T&-*S');
      }
      if (game === 'mini-sudoku') expect(record.gameStateUnion).toEqual({ miniSudokuGameState: [
        { cellIdx: 1, cellContentUnion: { cellValue: 2 } }, { cellIdx: 2, cellContentUnion: { cellValue: 2 } }] });
      if (game !== 'pinpoint') expect(record.timeElapsed).toBeGreaterThanOrEqual(2);
      saves++;
      saved = options.mode !== 'no-persistence';
      return route.fulfill({ status: options.mode === 'http-error' ? 403 : 200,
        json: { data: { data: { updateIdentityDashGames: { resourceKey: options.mode === 'wrong-resource' ? 'other' : urn } } } } });
    }
    if (method === 'POST' && /\/flagship-web\/rsc-action\/actions\/server-request/.test(url)) {
      const body = JSON.parse(postData!);
      expect(body.requestId).toBe('updateGameState');
      expect(body.requestedArguments.payload.gameTypeId).toBe(ids[game]);
      const complete = body.states.find((s: any) => s.key === 'gameBoardHasWon').value;
      if (complete) {
        for (const states of [body.states, body.requestedArguments.states]) {
          const values = Object.fromEntries(states.map((s: any) => [s.key, s.value]));
          expect(values.gameBoardHasWon).toBe(true);
          if (game === 'queens') expect(values[boardKeys[game]!].flatMap((v: string, i: number) => v === 'QUEEN' ? [i] : [])).toEqual([5, 9, 18, 27, 28, 38, 43]);
          else expect(values[boardKeys[game]!]).toEqual(boards[game]);
          expect(values.gameBoardPuzzleId.value).toBe('-999');
          expect(Number(values.gameBoardTimeElapsed.value)).toBeGreaterThanOrEqual(2000);
          expect(values.gameIsTutorialGameBinding).toBe(true);
          expect(values.fixtureUnrelatedBinding).toBe('preserve-me');
        }
        saves++;
        saved = options.mode !== 'no-persistence';
      } else { initialSaves++; }
      const resultGame = options.mode === 'wrong-resource' ? 'pinpoint' : game;
      return route.fulfill({ status: options.mode === 'http-error' ? 403 : 200,
        body: '0:' + JSON.stringify({ response: { errors: [], completionAction: complete ? { actions: [
          { value: { content: { url: { urlValue: { url: `/games/${resultGame}/results/` } } } } }] } : {} } }) + '\n',
        contentType: 'text/x-component' });
    }
    if (method !== 'GET' || !url.includes(`/games/${game}/`)) return route.abort();
    navigations++;
    const contract = template(game);
    if (options.staleContract) for (const states of [contract.states, contract.requestedArguments.states]) {
      (states.find(s => s.key === 'gameBoardPuzzleId')!.value as { value: string }).value = '-998';
    }
    const delivered = { gameUrn: { gameTypeId: ids[game], puzzleId: '-999' }, puzzle: puzzles[game] };
    // Fixtures reproduce page-provided data/hooks, never inject the extension scripts.
    const pageScript = boardKeys[game] ? `
      const board = document.querySelector('main > div');
      const save = {$type:'proto.sdui.actions.core.ServerRequest',value:${JSON.stringify(contract)}};
      const lifecycle = {actions:[{$type:'proto.sdui.actions.core.SetState'},save]};
      const compile = input => {
        if(input.actions.length !== 1 || input.actions[0] !== save) throw Error('Whole lifecycle must never run');
        return () => fetch('/flagship-web/rsc-action/actions/server-request', {
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(save.value)});
      };
      board.__reactFiber$fixture = {memoizedProps:{game:${JSON.stringify(delivered)},onDisappear:lifecycle},
        memoizedState:{memoizedState:[compile,[]],next:{memoizedState:[{func(){throw Error('Lifecycle');}},${options.brokenNative ? '[]' : '[lifecycle,compile]'}]}}};
    ` : '';
    const source = JSON.stringify({ entityUrn: urn, ...puzzles[game] as object }).replace(/</g, '\\u003c');
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>${game} fixture</title></head><body>
      <main><h1>${game}</h1>${saved ? '<a href="results/">See results</a>' : selectors[game]}
      ${options.hiddenResults && !saved ? '<a href="results/" hidden>See results</a>' : ''}</main>
      ${options.hiddenFrame && !saved ? '<iframe hidden srcdoc="&lt;a href=&quot;results/&quot;&gt;See results&lt;/a&gt;"></iframe>' : ''}
      <script type="application/json">${source}</script><script>
      sessionStorage.setItem('fixtureNavigations', String(Number(sessionStorage.getItem('fixtureNavigations')||0)+1));
      for(const event of ['pointerdown','keydown','input']) document.addEventListener(event,e=>{
        if(e.target.closest('main')) sessionStorage.setItem('fixtureBoardInput','yes');
      });${pageScript}</script></body></html>` });
  });
  return { stats: () => ({ saved, saves, initialSaves, navigations }) };
}

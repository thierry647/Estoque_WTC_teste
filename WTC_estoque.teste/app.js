const LEGACY_KEY = 'estoqueWtc.v1';
const DATABASE_NAME = 'estoqueWtcDatabase';
const DATABASE_VERSION = 1;
const ITEM_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 100;
const CODE_PAGE_SIZE = 200;
const TRASH_RETENTION_DAYS = 30;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const formatNumber = (value) => new Intl.NumberFormat('pt-BR').format(value);

function cleanFolderStatuses(statuses) {
  const seen = new Set();
  return (Array.isArray(statuses) ? statuses : []).map((status) => String(status || '').trim().slice(0, 50)).filter((status) => {
    const key = status.toLocaleLowerCase('pt-BR');
    if (!status || key === 'bom' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function folderKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function cleanTrash(entries) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.folder && entry?.deletedAt && new Date(entry.deletedAt).getTime() > cutoff)
    .map((entry) => {
      const folder = { ...entry.folder, statuses: cleanFolderStatuses(entry.folder.statuses) };
      const items = Array.isArray(entry.items) ? entry.items.map((item) => {
        const conditions = item.conditions && typeof item.conditions === 'object' ? { ...item.conditions } : {};
        if (item.unitStates && typeof item.unitStates === 'object') for (const [code, state] of Object.entries(item.unitStates)) conditions[code] ||= state;
        return { ...item, codes: Array.isArray(item.codes) ? item.codes.map(String) : [], conditions };
      }) : [];
      for (const item of items) for (const state of Object.values(item.conditions)) {
        const name = String(state || '').trim().slice(0, 50);
        if (name && name.toLocaleLowerCase('pt-BR') !== 'bom' && !folder.statuses.some((status) => status.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) folder.statuses.push(name);
      }
      return { ...entry, folder, items };
    });
}

function freshDatabase() {
  return { folders: [{ id: 'geral', name: 'Geral', statuses: [] }], items: [], history: [], trash: [] };
}

function normalizeDatabase(raw) {
  const oldFolders = Array.isArray(raw?.folders) ? raw.folders : raw?.pastas;
  const oldItems = Array.isArray(raw?.items) ? raw.items : raw?.itens;
  if (!Array.isArray(oldFolders) || !Array.isArray(oldItems)) throw new Error('Arquivo de estoque inválido.');

  const folders = [];
  const folderIds = new Map();
  const foldersByName = new Map();
  const folderIdsUsed = new Set();
  for (const source of oldFolders) {
    const name = String(source?.name || source?.nome || '').trim();
    if (!name) continue;
    const key = folderKey(name);
    let folder = foldersByName.get(key);
    if (!folder) {
      let id = String(source.id || makeId());
      if (folderIdsUsed.has(id)) id = makeId();
      folderIdsUsed.add(id);
      folder = { id, name, statuses: [] };
      folders.push(folder);
      foldersByName.set(key, folder);
    }
    folder.statuses = cleanFolderStatuses([...folder.statuses, ...(Array.isArray(source.statuses) ? source.statuses : [])]);
    if (source.id && !folderIds.has(String(source.id))) folderIds.set(String(source.id), folder.id);
  }
  let general = foldersByName.get(folderKey('Geral'));
  if (!general) {
    general = { id: folderIdsUsed.has('geral') ? makeId() : 'geral', name: 'Geral', statuses: [] };
    folders.unshift(general);
    foldersByName.set(folderKey('Geral'), general);
    folderIdsUsed.add(general.id);
  }

  const usedCodes = new Set();
  const usedItemIds = new Set();
  const items = oldItems.map((item) => {
    const name = String(item.name || item.nome || '').trim();
    const prefix = String(item.prefix || item.prefixo || '').trim();
    if (!name || !prefix) throw new Error('Há um item sem nome ou prefixo.');
    const requestedFolderId = folderIds.get(String(item.folderId || ''));
    const folder = folders.find((entry) => entry.id === requestedFolderId)
      || foldersByName.get(folderKey(item.pasta))
      || general;
    const conditions = item.conditions && typeof item.conditions === 'object' ? { ...item.conditions } : {};
    if (item.unitStates && typeof item.unitStates === 'object') for (const [code, state] of Object.entries(item.unitStates)) conditions[code] ||= state;
    const sourceCodes = Array.isArray(item.codes) ? item.codes : Array.isArray(item.codigos) ? item.codigos : [];
    const codes = [];
    const normalizedConditions = {};
    for (const sourceCode of sourceCodes) {
      const originalCode = String(sourceCode).trim();
      if (!originalCode) continue;
      let code = originalCode;
      let sequence = 1;
      while (usedCodes.has(code.toLocaleLowerCase('pt-BR'))) code = prefix + String(sequence++).padStart(4, '0');
      usedCodes.add(code.toLocaleLowerCase('pt-BR'));
      codes.push(code);
      if (conditions[originalCode]) normalizedConditions[code] = conditions[originalCode];
    }
    let id = String(item.id || makeId());
    if (usedItemIds.has(id)) id = makeId();
    usedItemIds.add(id);
    return { id, name, prefix, folderId: folder.id, codes, conditions: normalizedConditions };
  });

  for (const item of items) {
    const folder = folders.find((entry) => entry.id === item.folderId);
    if (!folder) continue;
    for (const status of Object.values(item.conditions)) {
      const name = String(status || '').trim().slice(0, 50);
      if (name && name.toLocaleLowerCase('pt-BR') !== 'bom' && !folder.statuses.some((entry) => entry.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) folder.statuses.push(name);
    }
  }
  const history = (Array.isArray(raw.history) ? raw.history : []).map((event) => {
    if (!event || typeof event !== 'object') return event;
    const folderId = folderIds.get(String(event.folderId || '')) || foldersByName.get(folderKey(event.folderName))?.id;
    const sourceFolderId = folderIds.get(String(event.sourceFolderId || '')) || foldersByName.get(folderKey(event.sourceFolderName))?.id;
    const destinationFolderId = folderIds.get(String(event.destinationFolderId || '')) || foldersByName.get(folderKey(event.destinationFolderName))?.id;
    return { ...event, ...(folderId ? { folderId } : {}), ...(sourceFolderId ? { sourceFolderId } : {}), ...(destinationFolderId ? { destinationFolderId } : {}) };
  });
  const trash = cleanTrash(raw.trash);
  for (const entry of trash) for (const item of entry.items) {
    const codes = [];
    const conditions = {};
    for (const originalCode of item.codes) {
      const oldCode = String(originalCode).trim();
      let code = oldCode;
      let sequence = 1;
      while (!code || usedCodes.has(code.toLocaleLowerCase('pt-BR'))) code = `${item.prefix || 'IT'}${String(sequence++).padStart(4, '0')}`;
      usedCodes.add(code.toLocaleLowerCase('pt-BR'));
      codes.push(code);
      if (item.conditions?.[oldCode]) conditions[code] = item.conditions[oldCode];
    }
    item.codes = codes;
    item.conditions = conditions;
  }
  return { ...raw, folders, items, history, trash };
}
let db = freshDatabase();
let idb = null;
let storageMode = 'indexeddb';
let activeFolder = 'all';
let currentPage = 0;
let historyPage = 0;
let codePage = 0;
let reservedCodes = new Set();
let selectedItemIds = new Set();
let visibleItemIds = [];
let searchTimer = 0;
const conditionSaveTimers = new WeakMap();

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao ler o banco de dados.'));
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar os dados.'));
    transaction.onabort = () => reject(transaction.error || new Error('A gravação foi cancelada.'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('items')) database.createObjectStore('items', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('history')) database.createObjectStore('history', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB não está disponível.'));
    request.onblocked = () => reject(new Error('Feche outras abas do estoque e tente novamente.'));
  });
}

async function readAllFromIndexedDB() {
  const transaction = idb.transaction(['meta', 'items', 'history'], 'readonly');
  const done = transactionResult(transaction);
  const metaStore = transaction.objectStore('meta');
  const foldersRequest = requestResult(metaStore.get('folders'));
  const trashRequest = requestResult(metaStore.get('trash'));
  const readyRequest = requestResult(metaStore.get('ready'));
  const itemsRequest = requestResult(transaction.objectStore('items').getAll());
  const historyRequest = requestResult(transaction.objectStore('history').getAll());
  const [foldersRecord, trashRecord, readyRecord, items, history] = await Promise.all([foldersRequest, trashRequest, readyRequest, itemsRequest, historyRequest]);
  await done;
  return { ready: readyRecord?.value === true, folders: foldersRecord?.value, trash: trashRecord?.value, items, history };
}

async function replaceAllInIndexedDB(data) {
  const transaction = idb.transaction(['meta', 'items', 'history'], 'readwrite');
  const done = transactionResult(transaction);
  const meta = transaction.objectStore('meta');
  const items = transaction.objectStore('items');
  const history = transaction.objectStore('history');
  meta.clear();
  items.clear();
  history.clear();
  meta.put({ key: 'folders', value: data.folders });
  meta.put({ key: 'trash', value: data.trash || [] });
  meta.put({ key: 'ready', value: true });
  data.items.forEach((item) => items.put(item));
  data.history.forEach((event) => history.put(event));
  await done;
}

function readLegacyDatabase() {
  try {
    const serialized = localStorage.getItem(LEGACY_KEY);
    return serialized ? normalizeDatabase(JSON.parse(serialized)) : null;
  } catch (error) {
    console.warn('Não foi possível migrar os dados antigos do navegador.', error);
    return null;
  }
}

function rebuildReservedCodes() {
  reservedCodes = new Set();
  for (const item of db.items) for (const code of item.codes) reservedCodes.add(code.toLocaleLowerCase('pt-BR'));
  for (const event of db.history) for (const code of event.codes || []) reservedCodes.add(String(code).toLocaleLowerCase('pt-BR'));
  for (const entry of db.trash) for (const item of entry.items || []) for (const code of item.codes || []) reservedCodes.add(String(code).toLocaleLowerCase('pt-BR'));
}

async function initializeStorage() {
  try {
    idb = await openDatabase();
    storageMode = 'indexeddb';
    const saved = await readAllFromIndexedDB();
    if (saved.ready) {
      const previous = { folders: saved.folders || [{ id: 'geral', name: 'Geral' }], items: saved.items, history: saved.history, trash: saved.trash };
      db = normalizeDatabase(previous);
      if (JSON.stringify(previous) !== JSON.stringify(db)) {
        try {
          const backupKey = `${LEGACY_KEY}.backup-before-repair`;
          if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, JSON.stringify(previous));
        } catch (backupError) { console.warn('Não foi possível guardar a cópia anterior à correção.', backupError); }
        await replaceAllInIndexedDB(db);
      }
    } else {
      const legacy = readLegacyDatabase();
      db = legacy || freshDatabase();
      await replaceAllInIndexedDB(db);
      if (legacy) {
        try { localStorage.removeItem(LEGACY_KEY); } catch (error) { console.warn('Os dados antigos continuam no navegador como cópia.', error); }
      }
    }
  } catch (error) {
    console.error('IndexedDB não pôde ser iniciado.', error);
    idb = null;
    storageMode = 'localStorage';
    db = readLegacyDatabase() || freshDatabase();
    toast('IndexedDB não disponível; usando o armazenamento antigo deste navegador.');
  }
  rebuildReservedCodes();
  render();
  void updateStorageInfo();
}

async function persistChanges(changes = {}) {
  if (!idb) {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(db));
    return;
  }
  const stores = [];
  if (changes.folders || changes.items?.length || changes.deletedItems?.length || changes.trash) stores.push('meta', 'items');
  if (changes.history?.length) stores.push('history');
  const transaction = idb.transaction([...new Set(stores)], 'readwrite');
  const done = transactionResult(transaction);
  if (changes.folders) transaction.objectStore('meta').put({ key: 'folders', value: db.folders });
  if (changes.trash) transaction.objectStore('meta').put({ key: 'trash', value: db.trash });
  for (const item of changes.items || []) transaction.objectStore('items').put(item);
  for (const itemId of changes.deletedItems || []) transaction.objectStore('items').delete(itemId);
  for (const event of changes.history || []) transaction.objectStore('history').put(event);
  await done;
}

async function replaceAll(data) {
  if (idb) await replaceAllInIndexedDB(data);
  else localStorage.setItem(LEGACY_KEY, JSON.stringify(data));
}

async function saveChanges(changes, rollback) {
  const oldTrash = db.trash;
  const cleanedTrash = cleanTrash(db.trash);
  const expiredTrash = JSON.stringify(cleanedTrash) !== JSON.stringify(db.trash);
  if (expiredTrash) db.trash = cleanedTrash;
  try {
    await persistChanges(expiredTrash ? { ...changes, trash: true } : changes);
    render();
    void updateStorageInfo();
    return true;
  } catch (error) {
    if (expiredTrash) db.trash = oldTrash;
    if (rollback) rollback();
    rebuildReservedCodes();
    render();
    const reason = error?.name === 'QuotaExceededError' ? 'O espaço de armazenamento acabou.' : 'Não foi possível salvar agora.';
    toast(`${reason} Exporte uma cópia e tente novamente.`);
    return false;
  }
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MiB`;
}

function downloadCsv(filename, rows) {
  const csvCell = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRowsForFolder(folderId) {
  const folder = db.folders.find((entry) => entry.id === folderId);
  const items = db.items.filter((item) => item.folderId === folderId);
  const rows = [['Código', 'Objeto', 'Estado', 'Pasta', 'Prefixo']];
  for (const item of items) {
    if (!item.codes.length) rows.push(['', item.name, 'Sem estoque', folder?.name || 'Geral', item.prefix]);
    else for (const code of item.codes) rows.push([code, item.name, item.conditions?.[code] || 'Bom', folder?.name || 'Geral', item.prefix]);
  }
  return { folder, items, rows, units: items.reduce((sum, item) => sum + item.codes.length, 0) };
}

function exportSlug(name) {
  return String(name || 'geral').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pasta';
}

function downloadSpreadsheet(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeXlsx(rows) {
  const encoder = new TextEncoder();
  const xmlEscape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const columnName = (index) => {
    let name = '';
    for (index += 1; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
    return name;
  };
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    return typeof value === 'number' ? `<c r="${ref}" t="n"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estoque" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  };
  const write16 = (view, offset, value) => view.setUint16(offset, value, true);
  const write32 = (view, offset, value) => view.setUint32(offset, value, true);
  const crc32 = (bytes) => {
    let crc = -1;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  };
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800); write16(localView, 8, 0);
    write32(localView, 14, crc); write32(localView, 18, data.length); write32(localView, 22, data.length); write16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20); write16(centralView, 8, 0x0800); write16(centralView, 10, 0);
    write32(centralView, 16, crc); write32(centralView, 20, data.length); write32(centralView, 24, data.length); write16(centralView, 28, nameBytes.length); write32(centralView, 42, localOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 8, centralParts.length); write16(endView, 10, centralParts.length); write32(endView, 12, centralSize); write32(endView, 16, centralOffset);
  const parts = [...localParts, ...centralParts, end];
  return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function copySpreadsheetText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}

function exportInventoryCsv() {
  const select = $('#exportFolder');
  select.innerHTML = db.folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)} · ${formatNumber(db.items.filter((item) => item.folderId === folder.id).length)} itens</option>`).join('');
  if (db.folders.some((folder) => folder.id === activeFolder)) select.value = activeFolder;
  $('#exportChooseStep').hidden = false;
  $('#exportConfirmStep').hidden = true;
  $('#exportConfirmCheck').checked = false;
  $('#exportTitle').textContent = 'Escolha o formato';
  $('#exportSubtitle').textContent = 'Selecione uma pasta e o formato da planilha.';
  $('#exportDialog').showModal();
}

function showExportConfirmation() {
  const folderId = $('#exportFolder').value;
  const data = exportRowsForFolder(folderId);
  if (!data.folder) return toast('Escolha uma pasta para exportar.');
  $('#exportConfirmFolder').textContent = data.folder.name;
  $('#exportConfirmDetails').textContent = `${formatNumber(data.items.length)} ${data.items.length === 1 ? 'item' : 'itens'} · ${formatNumber(data.units)} ${data.units === 1 ? 'unidade' : 'unidades'} com códigos`;
  const format = document.querySelector('input[name="exportFormat"]:checked')?.value;
  $('#exportConfirmNote').textContent = format === 'sheets' ? 'Uma nova planilha Google será aberta. Os dados ficarão copiados para você colar na célula A1.' : 'A exportação contém a pasta completa, inclusive itens sem unidades disponíveis.';
  $('#exportConfirmCheck').checked = false;
  $('#exportConfirmBtn').disabled = true;
  $('#exportChooseStep').hidden = true;
  $('#exportConfirmStep').hidden = false;
  $('#exportTitle').textContent = 'Confirme a exportação';
  $('#exportSubtitle').textContent = 'Revise os dados antes de continuar.';
}

async function confirmFolderExport() {
  const data = exportRowsForFolder($('#exportFolder').value);
  const format = document.querySelector('input[name="exportFormat"]:checked')?.value;
  if (!data.folder) return;
  const slug = exportSlug(data.folder.name);
  const rows = data.rows.map((row) => row.map((value) => typeof value === 'string' && /^\s*[=+@-]/.test(value) ? `'${value}` : value));
  $('#exportDialog').close();
  if (format === 'csv') {
    downloadCsv(`estoque-${slug}.csv`, rows);
    toast(`Pasta ${data.folder.name} exportada em CSV.`);
    return;
  }
  if (format === 'xlsx') {
    downloadSpreadsheet(makeXlsx(data.rows), `estoque-${slug}.xlsx`);
    toast(`Pasta ${data.folder.name} exportada para Excel.`);
    return;
  }
  const sheetWindow = window.open('https://docs.google.com/spreadsheets/create', '_blank');
  if (sheetWindow) sheetWindow.opener = null;
  const text = rows.map((row) => row.map((value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
  if (await copySpreadsheetText(text)) toast(sheetWindow ? 'Dados copiados. Cole na célula A1 da planilha Google.' : 'Dados copiados. Abra uma planilha Google e cole na célula A1.');
  else {
    downloadSpreadsheet(new Blob(['\ufeff', text], { type: 'text/tab-separated-values;charset=utf-8' }), `estoque-${slug}.tsv`);
    toast('Não foi possível copiar. Baixei os dados em TSV para importar no Google Sheets.');
  }
}

async function updateStorageInfo() {
  const info = $('#storageInfo');
  if (!info) return;
  if (storageMode === 'localStorage') {
    try {
      const size = JSON.stringify(db).length * 2;
      info.textContent = `Modo compatível · cerca de ${formatMiB(size)} usados`;
    } catch { info.textContent = 'Modo compatível · espaço não estimado'; }
    return;
  }
  if (!navigator.storage?.estimate) {
    info.textContent = 'IndexedDB · espaço gerenciado pelo navegador';
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usageDetails?.indexedDB ?? estimate.usage ?? 0;
    info.textContent = `IndexedDB · ${formatMiB(usage)} usados / ${formatMiB(estimate.quota || 0)} estimados`;
  } catch {
    info.textContent = 'IndexedDB · espaço gerenciado pelo navegador';
  }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3200);
}

function suggestPrefix(name) {
  const chars = Array.from(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).filter((char) => /[a-z]/i.test(char));
  if (!chars.length) return 'IT';
  const consonants = chars.filter((char) => !/[aeiou]/i.test(char));
  const out = consonants.length >= 2 ? consonants.slice(0, 2).join('') : chars.slice(0, 2).join('');
  return out.charAt(0).toUpperCase() + out.slice(1).toLowerCase();
}

function nextCodes(prefix, quantity) {
  const codes = [];
  let sequence = 1;
  while (codes.length < quantity) {
    const code = prefix + String(sequence).padStart(4, '0');
    const normalized = code.toLocaleLowerCase('pt-BR');
    if (!reservedCodes.has(normalized)) {
      codes.push(code);
      reservedCodes.add(normalized);
    }
    sequence += 1;
  }
  return codes;
}

function historyFolderId(event) {
  if (event.folderId) return event.folderId;
  const trashedItem = db.trash.find((entry) => entry.items.some((item) => item.id === event.itemId));
  if (trashedItem) return trashedItem.folder.id;
  return db.trash.find((entry) => entry.folder.name === event.folderName)?.folder.id
    || db.folders.find((folder) => folder.name === event.folderName)?.id
    || null;
}

function folderMovementTotals(folder) {
  return db.history.reduce((totals, event) => {
    const quantity = Number(event.quantity) || 0;
    if (event.type === 'transferencia') {
      if (event.sourceFolderId === folder.id) totals.exits += quantity;
      if (event.destinationFolderId === folder.id) totals.entries += quantity;
      return totals;
    }
    if (historyFolderId(event) !== folder.id) return totals;
    if (event.type === 'entrada') totals.entries += quantity;
    else if (event.type === 'saida') totals.exits += quantity;
    return totals;
  }, { entries: 0, exits: 0 });
}

function updateItemFolderSummary() {
  const folder = db.folders.find((entry) => entry.id === $('#itemFolder').value);
  if (!folder) { $('#itemFolderSummary').textContent = ''; return; }
  const totals = folderMovementTotals(folder);
  const units = db.items.filter((item) => item.folderId === folder.id).reduce((sum, item) => sum + item.codes.length, 0);
  $('#itemFolderSummary').textContent = `Estoque: ${formatNumber(units)} un. · Entradas: ${formatNumber(totals.entries)} · Saídas: ${formatNumber(totals.exits)}`;
}

function render() {
  const previousFilter = $('#folderFilter').value || 'all';
  const folderCounts = new Map(db.folders.map((folder) => [folder.id, 0]));
  let totalUnits = 0;
  for (const item of db.items) {
    folderCounts.set(item.folderId, (folderCounts.get(item.folderId) || 0) + 1);
    totalUnits += item.codes.length;
  }
  $('#folderList').innerHTML = db.folders.map((folder) => {
    return `<div class="folder-entry"><button class="folder-row ${activeFolder === folder.id ? 'active' : ''}" data-folder="${esc(folder.id)}"><i class="folder-dot"></i>${esc(folder.name)}<span class="count">${formatNumber(folderCounts.get(folder.id) || 0)}</span></button>${folderKey(folder.name) === folderKey('Geral') ? '' : `<button class="icon-btn folder-delete" type="button" title="Mover pasta para a lixeira" aria-label="Excluir pasta ${esc(folder.name)}" data-delete-folder="${esc(folder.id)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg></button>`}</div>`;
  }).join('');
  $('#folderFilter').innerHTML = '<option value="all">Todas as pastas</option>' + db.folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`).join('');
  $('#folderFilter').value = db.folders.some((folder) => folder.id === previousFilter) || previousFilter === 'all' ? previousFilter : 'all';
  const folderSelect = $('#itemFolder');
  const oldFolder = folderSelect.value;
  folderSelect.innerHTML = db.folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`).join('');
  if (db.folders.some((folder) => folder.id === oldFolder)) folderSelect.value = oldFolder;
  updateItemFolderSummary();

  $('#navCount').textContent = formatNumber(db.items.length);
  $('#statTypes').textContent = formatNumber(db.items.length);
  $('#statFolders').textContent = formatNumber(db.folders.length);
  $('#statUnits').textContent = formatNumber(totalUnits);
  $('#trashCount').textContent = formatNumber(db.trash.length);
  const dashboardFolder = db.folders.find((entry) => entry.id === (activeFolder !== 'all' ? activeFolder : $('#folderFilter').value));
  const folderInsights = $('#folderInsights');
  folderInsights.hidden = !dashboardFolder;
  if (dashboardFolder) {
    const totals = folderMovementTotals(dashboardFolder);
    const stock = db.items.filter((item) => item.folderId === dashboardFolder.id).reduce((sum, item) => sum + item.codes.length, 0);
    $('#folderStockCount').textContent = formatNumber(stock);
    $('#folderEntryCount').textContent = formatNumber(totals.entries);
    $('#folderExitCount').textContent = formatNumber(totals.exits);
  }
  const folder = db.folders.find((entry) => entry.id === activeFolder);
  const title = folder ? folder.name : 'Todos os itens';
  $('#pageTitle').textContent = title;
  $('#crumbText').textContent = title;

  const query = $('#searchInput').value.trim().toLocaleLowerCase('pt-BR');
  const folderFilter = $('#folderFilter').value;
  const filteredItems = db.items.filter((item) => {
    if (activeFolder !== 'all' && item.folderId !== activeFolder) return false;
    if (folderFilter !== 'all' && item.folderId !== folderFilter) return false;
    if (!query) return true;
    return item.name.toLocaleLowerCase('pt-BR').includes(query)
      || item.prefix.toLocaleLowerCase('pt-BR').includes(query)
      || item.codes.some((code) => code.toLocaleLowerCase('pt-BR').includes(query));
  });

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / ITEM_PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount - 1);
  const start = currentPage * ITEM_PAGE_SIZE;
  const pageItems = filteredItems.slice(start, start + ITEM_PAGE_SIZE);
  visibleItemIds = pageItems.map((item) => item.id);
  $('#itemsBody').innerHTML = pageItems.map((item) => {
    const itemFolder = db.folders.find((entry) => entry.id === item.folderId);
    return `<tr><td><input class="selection-box" type="checkbox" data-select-item="${esc(item.id)}" aria-label="Selecionar ${esc(item.name)}" ${selectedItemIds.has(item.id) ? 'checked' : ''}></td><td><div class="object-cell"><div class="object-icon">${esc(Array.from(item.name.trim()).slice(0, 2).join('').toUpperCase())}</div><div><div class="object-name">${esc(item.name)}</div><div class="object-prefix">Prefixo ${esc(item.prefix)}</div></div></div></td><td><span class="folder-pill"><i></i>${esc(itemFolder?.name || 'Geral')}</span></td><td><span class="qty">${formatNumber(item.codes.length)}</span> un.</td><td><button class="code-link" data-codes="${esc(item.id)}">Códigos e estado →</button></td><td><button class="code-link" data-move="${esc(item.id)}">+ Entrada / − Saída</button></td><td><div class="row-actions"><button class="icon-btn" title="Excluir cadastro" aria-label="Excluir ${esc(item.name)}" data-delete="${esc(item.id)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg></button></div></td></tr>`;
  }).join('');

  const empty = filteredItems.length === 0;
  $('#emptyState').hidden = !empty;
  $('#itemsBody').closest('table').style.display = empty ? 'none' : '';
  $('#emptyTitle').textContent = db.items.length ? 'Nenhum item encontrado' : 'Seu estoque está vazio';
  $('#emptyText').textContent = db.items.length ? 'Tente mudar a busca ou o filtro.' : 'Adicione seu primeiro item para começar.';
  const displayedThrough = Math.min(start + pageItems.length, filteredItems.length);
  $('#shownCount').textContent = filteredItems.length ? `${formatNumber(start + 1)}–${formatNumber(displayedThrough)} de ${formatNumber(filteredItems.length)} cadastros` : '0 cadastros';
  $('#itemsPage').textContent = `Página ${currentPage + 1} de ${pageCount}`;
  $('#itemsPrev').disabled = currentPage === 0;
  $('#itemsNext').disabled = currentPage >= pageCount - 1;
  const selectedOnPage = pageItems.filter((item) => selectedItemIds.has(item.id)).length;
  $('#selectPage').checked = pageItems.length > 0 && selectedOnPage === pageItems.length;
  $('#selectPage').indeterminate = selectedOnPage > 0 && selectedOnPage < pageItems.length;
  $('#bulkBar').hidden = selectedItemIds.size === 0;
  $('#selectedCount').textContent = `${formatNumber(selectedItemIds.size)} selecionados`;
}

function openItem() {
  $('#itemName').value = '';
  $('#itemQty').value = '1';
  $('#itemPrefix').value = '';
  if (activeFolder !== 'all' && db.folders.some((folder) => folder.id === activeFolder)) $('#itemFolder').value = activeFolder;
  updateItemFolderSummary();
  $('#itemDialog').showModal();
  $('#itemName').focus();
}

function openMovement(itemId) {
  const item = db.items.find((entry) => entry.id === itemId);
  if (!item) return;
  $('#movementForm').dataset.itemId = itemId;
  $('#movementItemName').textContent = `${item.name} · ${formatNumber(item.codes.length)} unidade(s) · pasta ${db.folders.find((folder) => folder.id === item.folderId)?.name || 'Geral'}`;
  $('#movementQty').value = '1';
  $('#movementNote').value = '';
  $('#movementType').value = 'entrada';
  updateMovementFields();
  $('#movementDialog').showModal();
}

function updateMovementFields() {
  const item = db.items.find((entry) => entry.id === $('#movementForm').dataset.itemId);
  const isOut = $('#movementType').value === 'saida';
  const destination = $('#movementDestination');
  const previous = destination.value;
  const folders = db.folders.filter((folder) => !isOut || folder.id !== item?.folderId);
  destination.innerHTML = folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`).join('');
  if (folders.some((folder) => folder.id === previous)) destination.value = previous;
  else if (!isOut && folders.some((folder) => folder.id === item?.folderId)) destination.value = item.folderId;
  $('#movementDestinationField').hidden = !isOut;
  destination.disabled = !folders.length;
  destination.required = isOut;
  $('#movementQtyField').hidden = isOut;
  $('#movementQty').disabled = isOut;
  $('#movementQty').required = !isOut;
  $('#movementSubmitBtn').textContent = isOut ? 'Mover para a pasta' : 'Registrar entrada';
  $('#movementStockHint').textContent = isOut
    ? `A saída transfere todas as ${formatNumber(item?.codes.length || 0)} unidades para a pasta escolhida e mantém os códigos.`
    : 'A entrada gera códigos novos na pasta atual.';
}

function transferItemToFolder(item, destination, notes = '') {
  const source = db.folders.find((folder) => folder.id === item.folderId);
  if (!source || !destination || source.id === destination.id) return null;
  const oldFolderId = item.folderId;
  const oldStatuses = [...(destination.statuses || [])];
  for (const status of Object.values(item.conditions || {})) {
    if (status && status !== 'Bom' && !destination.statuses.some((entry) => entry.toLocaleLowerCase('pt-BR') === status.toLocaleLowerCase('pt-BR'))) destination.statuses.push(status);
  }
  const event = { id: makeId(), type: 'transferencia', itemId: item.id, itemName: item.name, prefix: item.prefix, sourceFolderId: source.id, sourceFolderName: source.name, destinationFolderId: destination.id, destinationFolderName: destination.name, folderId: source.id, folderName: source.name, quantity: item.codes.length, codes: [...item.codes], notes, createdAt: new Date().toISOString() };
  item.folderId = destination.id;
  db.history.unshift(event);
  return { event, oldFolderId, oldStatuses, destination };
}

function printLabels(item) {
  const folder = db.folders.find((entry) => entry.id === item.folderId);
  $('#printArea').innerHTML = `<div class="print-labels">${item.codes.map((code) => `<div class="print-label"><div class="print-label-name">${esc(item.name)}</div><div class="print-label-code">${esc(code)}</div><div class="print-label-folder">${esc(folder?.name || 'Geral')}</div></div>`).join('')}</div>`;
  window.print();
}

function renderTrash() {
  $('#trashCount').textContent = formatNumber(db.trash.length);
  $('#trashList').innerHTML = db.trash.length ? db.trash.map((entry) => {
    const days = Math.max(1, Math.ceil((new Date(entry.deletedAt).getTime() + TRASH_RETENTION_DAYS * 86400000 - Date.now()) / 86400000));
    const names = entry.items.length ? entry.items.map((item) => item.name).join(', ') : 'Nenhum item';
    return `<div class="trash-entry"><div class="trash-entry-head"><div><div class="trash-entry-title">${esc(entry.folder.name)}</div><div class="trash-entry-info">Excluída em ${new Date(entry.deletedAt).toLocaleDateString('pt-BR')} · expira em ${days} dia(s) · ${formatNumber(entry.items.length)} ${entry.items.length === 1 ? 'item' : 'itens'}</div><div class="trash-entry-items">${esc(names)}</div></div><div class="trash-entry-actions"><button class="btn" type="button" data-restore-folder="${esc(entry.id)}">Restaurar</button><button class="btn btn-danger" type="button" data-purge-folder="${esc(entry.id)}">Apagar</button></div></div></div>`;
  }).join('') : '<div class="empty">A lixeira está vazia.</div>';
}

async function openTrash() {
  const previousLength = db.trash.length;
  db.trash = cleanTrash(db.trash);
  if (previousLength !== db.trash.length && !(await saveChanges({ trash: true }))) return;
  renderTrash();
  $('#trashDialog').showModal();
}

async function moveFolderToTrash(folderId) {
  const index = db.folders.findIndex((folder) => folder.id === folderId);
  if (index < 0) return;
  const folder = db.folders[index];
  if (folderKey(folder.name) === folderKey('Geral')) return toast('A pasta Geral não pode ser excluída.');
  const items = db.items.filter((item) => item.folderId === folderId);
  if (!confirm(`Mover a pasta “${folder.name}” e ${items.length} ${items.length === 1 ? 'item' : 'itens'} para a lixeira?`)) return;
  const oldItems = db.items;
  const oldTrash = db.trash;
  const oldActiveFolder = activeFolder;
  db.folders.splice(index, 1);
  db.items = db.items.filter((item) => item.folderId !== folderId);
  db.trash = [{ id: makeId(), folder, items, deletedAt: new Date().toISOString() }, ...db.trash];
  if (activeFolder === folderId) activeFolder = 'all';
  if ($('#folderFilter').value === folderId) $('#folderFilter').value = 'all';
  if (await saveChanges({ folders: true, deletedItems: items.map((item) => item.id), trash: true }, () => {
    db.folders.splice(index, 0, folder);
    db.items = oldItems;
    db.trash = oldTrash;
    activeFolder = oldActiveFolder;
  })) {
    items.forEach((item) => selectedItemIds.delete(item.id));
    toast('Pasta movida para a lixeira por 30 dias.');
  }
}

async function restoreFolderFromTrash(entryId) {
  const entry = db.trash.find((row) => row.id === entryId);
  if (!entry) return;
  if (db.folders.some((folder) => folder.id === entry.folder.id || folderKey(folder.name) === folderKey(entry.folder.name))) return toast('Já existe uma pasta com esse nome. Exclua a pasta atual antes de restaurar.');
  const oldFolders = db.folders;
  const oldItems = db.items;
  const oldTrash = db.trash;
  db.folders = [...db.folders, entry.folder];
  db.items = [...db.items, ...entry.items];
  db.trash = db.trash.filter((row) => row.id !== entryId);
  if (await saveChanges({ folders: true, items: entry.items, trash: true }, () => { db.folders = oldFolders; db.items = oldItems; db.trash = oldTrash; })) {
    renderTrash();
    toast('Pasta e itens restaurados.');
  }
}

async function purgeTrashEntry(entryId) {
  const entry = db.trash.find((row) => row.id === entryId);
  if (!entry || !confirm(`Apagar definitivamente a pasta “${entry.folder.name}” e seus itens?`)) return;
  const oldTrash = db.trash;
  db.trash = db.trash.filter((row) => row.id !== entryId);
  if (await saveChanges({ trash: true }, () => { db.trash = oldTrash; })) {
    renderTrash();
    toast('Pasta apagada definitivamente.');
  }
}

function renderHistory() {
  const pageCount = Math.max(1, Math.ceil(db.history.length / HISTORY_PAGE_SIZE));
  historyPage = Math.min(historyPage, pageCount - 1);
  const start = historyPage * HISTORY_PAGE_SIZE;
  const events = db.history.slice(start, start + HISTORY_PAGE_SIZE);
  $('#historyList').innerHTML = events.length ? events.map((event) => {
    const transfer = event.type === 'transferencia';
    const label = transfer ? 'Transferência' : event.type === 'entrada' ? 'Entrada' : 'Saída';
    const details = transfer
      ? `De ${event.sourceFolderName || 'pasta'} para ${event.destinationFolderName || 'pasta'}${event.notes ? ` · ${event.notes}` : ''}`
      : event.type === 'entrada'
        ? `Destino: ${event.folderName || 'Geral'}${event.notes ? ` · ${event.notes}` : ''}`
        : `Pasta de origem: ${event.folderName || 'Geral'} · destino não registrado neste histórico antigo${event.notes ? ` · ${event.notes}` : ''}`;
    const quantity = transfer ? `${formatNumber(event.quantity || 0)} un.` : `${event.type === 'entrada' ? '+' : '−'}${formatNumber(event.quantity || 0)} un.`;
    return `<div class="history-row"><div class="history-type ${transfer ? 'transfer' : event.type === 'entrada' ? 'in' : 'out'}">${label}<div class="history-meta">${event.createdAt ? new Date(event.createdAt).toLocaleDateString('pt-BR') : ''}</div></div><div><strong>${esc(event.itemName || 'Item')}</strong><div class="history-meta">${esc(details)}</div></div><div class="history-qty">${quantity}</div></div>`;
  }).join('') : '<div class="empty">Nenhuma movimentação registrada ainda.</div>';
  $('#historyPage').textContent = `Página ${historyPage + 1} de ${pageCount}`;
  $('#historyPrev').disabled = historyPage === 0;
  $('#historyNext').disabled = historyPage >= pageCount - 1;
}

function renderFolderStateControls(item) {
  const folder = db.folders.find((entry) => entry.id === item.folderId);
  if (!folder) return;
  folder.statuses = cleanFolderStatuses(folder.statuses);
  $('#folderStateTags').innerHTML = `<span class="folder-state-tag">Bom</span>` + folder.statuses.map((status) => `<span class="folder-state-tag">${esc(status)}<button class="folder-state-remove" type="button" title="Excluir estado ${esc(status)}" aria-label="Excluir estado ${esc(status)}" data-remove-folder-state="${esc(status)}">×</button></span>`).join('');
}

function renderCodePage() {
  const item = db.items.find((entry) => entry.id === $('#codesDialog').dataset.itemId);
  if (!item) return;
  renderFolderStateControls(item);
  const folder = db.folders.find((entry) => entry.id === item.folderId);
  const statuses = ['Bom', ...(folder?.statuses || [])];
  const pageCount = Math.max(1, Math.ceil(item.codes.length / CODE_PAGE_SIZE));
  codePage = Math.min(codePage, pageCount - 1);
  const start = codePage * CODE_PAGE_SIZE;
  $('#codeList').innerHTML = item.codes.slice(start, start + CODE_PAGE_SIZE).map((code) => {
    const state = item.conditions?.[code] || 'Bom';
    return `<div class="code-unit-row"><div class="code-chip">${esc(code)}</div><div><div class="condition-label">Estado da unidade</div><select class="condition-input" aria-label="Estado de ${esc(code)}" data-condition-item="${esc(item.id)}" data-condition-code="${esc(code)}">${statuses.map((status) => `<option value="${esc(status)}" ${state === status ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></div></div>`;
  }).join('');
  $('#codesPage').textContent = `Página ${codePage + 1} de ${pageCount}`;
  $('#codesPrev').disabled = codePage === 0;
  $('#codesNext').disabled = codePage >= pageCount - 1;
}

async function addFolderStatus() {
  const item = db.items.find((entry) => entry.id === $('#codesDialog').dataset.itemId);
  const folder = item && db.folders.find((entry) => entry.id === item.folderId);
  const name = $('#newFolderState').value.trim().slice(0, 50);
  if (!folder || !name) return;
  const key = name.toLocaleLowerCase('pt-BR');
  if (key === 'bom' || folder.statuses.some((status) => status.toLocaleLowerCase('pt-BR') === key)) return toast('Esse estado já existe ou é reservado pelo sistema.');
  const oldStatuses = [...folder.statuses];
  folder.statuses.push(name);
  if (await saveChanges({ folders: true }, () => { folder.statuses = oldStatuses; })) {
    $('#newFolderState').value = '';
    renderCodePage();
    toast('Estado adicionado a esta pasta.');
  }
}

async function removeFolderStatus(status) {
  const current = db.items.find((entry) => entry.id === $('#codesDialog').dataset.itemId);
  const folder = current && db.folders.find((entry) => entry.id === current.folderId);
  if (!folder) return;
  const affected = db.items.filter((item) => item.folderId === folder.id && Object.values(item.conditions || {}).includes(status));
  const count = affected.reduce((sum, item) => sum + Object.values(item.conditions || {}).filter((value) => value === status).length, 0);
  if (!confirm(`Excluir o estado “${status}” desta pasta? ${count} unidade(s) voltarão para “Bom”.`)) return;
  const oldStatuses = [...folder.statuses];
  const oldConditions = affected.map((item) => [item, { ...(item.conditions || {}) }]);
  folder.statuses = folder.statuses.filter((entry) => entry !== status);
  for (const item of affected) {
    for (const [code, value] of Object.entries(item.conditions || {})) if (value === status) delete item.conditions[code];
  }
  if (await saveChanges({ folders: true, items: affected }, () => {
    folder.statuses = oldStatuses;
    for (const [item, conditions] of oldConditions) item.conditions = conditions;
  })) { renderCodePage(); toast('Estado excluído desta pasta.'); }
  else renderCodePage();
}

function openBulkMove() {
  const selected = db.items.filter((item) => selectedItemIds.has(item.id));
  if (!selected.length) return toast('Selecione pelo menos um cadastro.');
  if (db.folders.length < 2) {
    $('#destinationWarningDialog').dataset.returnMode = 'bulk';
    $('#destinationWarningDialog').dataset.itemId = '';
    $('#destinationWarningDialog').showModal();
    return;
  }
  $('#bulkMoveDescription').textContent = `${formatNumber(selected.length)} cadastro(s) selecionado(s). Os códigos e as condições serão mantidos.`;
  $('#bulkMoveFolder').innerHTML = db.folders.map((folder) => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`).join('');
  $('#bulkMoveDialog').showModal();
}

$('#itemName').addEventListener('input', (event) => {
  const prefix = $('#itemPrefix');
  if (!prefix.dataset.edited) prefix.value = suggestPrefix(event.target.value);
});
$('#itemPrefix').addEventListener('input', (event) => { event.target.dataset.edited = event.target.value ? '1' : ''; });

$('#itemForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#itemName').value.trim();
  const quantity = Number($('#itemQty').value);
  const prefix = $('#itemPrefix').value.trim().replace(/[^a-z0-9]/gi, '');
  if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return toast('Confira o nome e a quantidade.');
  if (!prefix) return toast('Informe um prefixo para os códigos.');
  const item = { id: makeId(), name, prefix, folderId: $('#itemFolder').value, codes: nextCodes(prefix, quantity), conditions: {} };
  const folder = db.folders.find((entry) => entry.id === item.folderId);
  const entry = { id: makeId(), type: 'entrada', itemId: item.id, folderId: item.folderId, itemName: item.name, prefix: item.prefix, folderName: folder?.name || 'Geral', quantity, codes: item.codes, notes: 'Cadastro inicial', createdAt: new Date().toISOString() };
  db.items.unshift(item);
  db.history.unshift(entry);
  rebuildReservedCodes();
  $('#itemDialog').close();
  $('#itemPrefix').dataset.edited = '';
  if (await saveChanges({ items: [item], history: [entry] }, () => {
    db.items = db.items.filter((row) => row.id !== item.id);
    db.history = db.history.filter((row) => row.id !== entry.id);
  })) toast(`${formatNumber(quantity)} ${quantity === 1 ? 'unidade adicionada' : 'unidades adicionadas'} com códigos únicos.`);
});

$('#folderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#folderName').value.trim();
  if (!name) return;
  if (db.folders.some((folder) => folderKey(folder.name) === folderKey(name))) return toast('Já existe uma pasta com esse nome.');
  const folder = { id: makeId(), name, statuses: [] };
  const returnMode = $('#folderDialog').dataset.returnMode || '';
  const returnItemId = $('#folderDialog').dataset.itemId || '';
  db.folders.push(folder);
  activeFolder = folder.id;
  $('#folderDialog').close();
  $('#folderName').value = '';
  if (await saveChanges({ folders: true }, () => { db.folders = db.folders.filter((row) => row.id !== folder.id); activeFolder = 'all'; })) {
    toast('Pasta criada.');
    if (returnMode === 'movement' && $('#movementDialog').open && $('#movementForm').dataset.itemId === returnItemId) {
      $('#movementType').value = 'saida';
      updateMovementFields();
      $('#movementDestination').value = folder.id;
    } else if (returnMode === 'bulk') {
      openBulkMove();
      if ($('#bulkMoveDialog').open) $('#bulkMoveFolder').value = folder.id;
    }
  }
  $('#folderDialog').dataset.returnMode = '';
  $('#folderDialog').dataset.itemId = '';
});

$('#folderList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-folder]');
  if (button) { activeFolder = button.dataset.folder; currentPage = 0; $('#folderFilter').value = 'all'; render(); }
});
$('#folderList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-folder]');
  if (button) { event.preventDefault(); event.stopPropagation(); void moveFolderToTrash(button.dataset.deleteFolder); }
});
$('#trashList').addEventListener('click', (event) => {
  const restore = event.target.closest('[data-restore-folder]');
  if (restore) { void restoreFolderFromTrash(restore.dataset.restoreFolder); return; }
  const purge = event.target.closest('[data-purge-folder]');
  if (purge) void purgeTrashEntry(purge.dataset.purgeFolder);
});
document.querySelector('.sidebar-nav').addEventListener('click', () => { activeFolder = 'all'; currentPage = 0; $('#folderFilter').value = 'all'; render(); });
$('#addFolderBtn').addEventListener('click', () => { $('#folderDialog').dataset.returnMode = ''; $('#folderDialog').dataset.itemId = ''; $('#folderDialog').showModal(); $('#folderName').focus(); });
$('#trashBtn').addEventListener('click', () => { void openTrash(); });
$('#itemFolder').addEventListener('change', updateItemFolderSummary);
$('#newItemBtn').addEventListener('click', openItem);
$('#newItemTop').addEventListener('click', openItem);
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentPage = 0; render(); }, 120);
});
$('#folderFilter').addEventListener('change', () => { currentPage = 0; render(); });
$('#itemsPrev').addEventListener('click', () => { currentPage = Math.max(0, currentPage - 1); render(); });
$('#itemsNext').addEventListener('click', () => { currentPage += 1; render(); });
$('#historyPrev').addEventListener('click', () => { historyPage = Math.max(0, historyPage - 1); renderHistory(); });
$('#historyNext').addEventListener('click', () => { historyPage += 1; renderHistory(); });
$('#codesPrev').addEventListener('click', () => { codePage = Math.max(0, codePage - 1); renderCodePage(); });
$('#codesNext').addEventListener('click', () => { codePage += 1; renderCodePage(); });
$('#addFolderStateBtn').addEventListener('click', () => { void addFolderStatus(); });
$('#newFolderState').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void addFolderStatus(); } });
$('#folderStateTags').addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-folder-state]');
  if (button) void removeFolderStatus(button.dataset.removeFolderState);
});
$('#itemsBody').addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select-item]');
  if (!checkbox) return;
  if (checkbox.checked) selectedItemIds.add(checkbox.dataset.selectItem);
  else selectedItemIds.delete(checkbox.dataset.selectItem);
  render();
});
$('#selectPage').addEventListener('change', (event) => {
  for (const itemId of visibleItemIds) {
    if (event.target.checked) selectedItemIds.add(itemId);
    else selectedItemIds.delete(itemId);
  }
  render();
});
$('#clearSelection').addEventListener('click', () => { selectedItemIds.clear(); render(); });
$('#bulkMoveBtn').addEventListener('click', openBulkMove);
$('#bulkMoveForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const destination = $('#bulkMoveFolder').value;
  const selected = db.items.filter((item) => selectedItemIds.has(item.id));
  const moving = selected.filter((item) => item.folderId !== destination);
  if (!moving.length) return toast('Os itens selecionados já estão nessa pasta.');
  const destinationFolder = db.folders.find((folder) => folder.id === destination);
  if (!destinationFolder) return toast('Escolha uma pasta de destino existente.');
  const oldFolders = moving.map((item) => [item, item.folderId]);
  const oldDestinationStatuses = [...(destinationFolder?.statuses || [])];
  const transfers = [];
  for (const item of moving) {
    const transfer = transferItemToFolder(item, destinationFolder, 'Transferência em lote');
    if (transfer) transfers.push(transfer.event);
  }
  if (await saveChanges({ items: moving, folders: true, history: transfers }, () => {
    for (const [item, folderId] of oldFolders) item.folderId = folderId;
    if (destinationFolder) destinationFolder.statuses = oldDestinationStatuses;
    db.history = db.history.filter((entry) => !transfers.some((transfer) => transfer.id === entry.id));
  })) {
    selectedItemIds.clear();
    $('#bulkMoveDialog').close();
    render();
    toast(`${formatNumber(moving.length)} cadastro(s) movido(s).`);
  }
});

document.body.addEventListener('click', async (event) => {
  const close = event.target.closest('[data-close]');
  if (close) { $('#' + close.dataset.close).close(); return; }
  const codeButton = event.target.closest('[data-codes]');
  if (codeButton) {
    const item = db.items.find((entry) => entry.id === codeButton.dataset.codes);
    if (!item) return;
    $('#codesTitle').textContent = item.name;
    $('#codesSubtitle').textContent = `Pasta: ${db.folders.find((folder) => folder.id === item.folderId)?.name || 'Geral'} · Prefixo ${item.prefix}`;
    $('#codesTotal').textContent = `${formatNumber(item.codes.length)} unidades`;
    $('#codesDialog').dataset.itemId = item.id;
    codePage = 0;
    renderCodePage();
    $('#codesDialog').showModal();
    return;
  }
  if (event.target.closest('[data-print]')) {
    const item = db.items.find((entry) => entry.id === $('#codesDialog').dataset.itemId);
    if (item) printLabels(item);
    return;
  }
  const moveButton = event.target.closest('[data-move]');
  if (moveButton) { openMovement(moveButton.dataset.move); return; }
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    const index = db.items.findIndex((entry) => entry.id === deleteButton.dataset.delete);
    if (index < 0) return;
    const [item] = db.items.splice(index, 1);
    if (confirm(`Excluir “${item.name}” e suas ${item.codes.length} unidades do saldo atual? O histórico será mantido.`)) {
      if (await saveChanges({ deletedItems: [item.id] }, () => { db.items.splice(index, 0, item); })) {
        selectedItemIds.delete(item.id);
        render();
        toast('Cadastro excluído.');
      }
    } else db.items.splice(index, 0, item);
  }
});

async function saveConditionInput(input) {
  const item = db.items.find((entry) => entry.id === input.dataset.conditionItem);
  if (!item) return;
  const code = input.dataset.conditionCode;
  const previousValue = item.conditions?.[code] || 'Bom';
  const value = input.value.trim().slice(0, 50) || 'Bom';
  if (value === previousValue) return;
  const oldConditions = { ...(item.conditions || {}) };
  item.conditions ||= {};
  if (value === 'Bom') delete item.conditions[code];
  else item.conditions[code] = value;
  if (await saveChanges({ items: [item] }, () => { item.conditions = oldConditions; })) toast('Condição salva.');
  else renderCodePage();
}

document.body.addEventListener('input', (event) => {
  const input = event.target.closest('[data-condition-code]');
  if (!input) return;
  clearTimeout(conditionSaveTimers.get(input));
  conditionSaveTimers.set(input, setTimeout(() => { void saveConditionInput(input); }, 350));
});
document.body.addEventListener('change', (event) => {
  const input = event.target.closest('[data-condition-code]');
  if (!input) return;
  clearTimeout(conditionSaveTimers.get(input));
  conditionSaveTimers.delete(input);
  void saveConditionInput(input);
});

$('#movementType').addEventListener('change', () => {
  const item = db.items.find((entry) => entry.id === $('#movementForm').dataset.itemId);
  if ($('#movementType').value === 'saida' && !db.folders.some((folder) => folder.id !== item?.folderId)) {
    $('#destinationWarningDialog').dataset.returnMode = 'movement';
    $('#destinationWarningDialog').dataset.itemId = item?.id || '';
    $('#movementType').value = 'entrada';
    updateMovementFields();
    $('#destinationWarningDialog').showModal();
    return;
  }
  updateMovementFields();
});
$('#movementDestination').addEventListener('change', updateMovementFields);
$('#createDestinationFolderBtn').addEventListener('click', () => {
  const warning = $('#destinationWarningDialog');
  $('#folderDialog').dataset.returnMode = warning.dataset.returnMode || '';
  $('#folderDialog').dataset.itemId = warning.dataset.itemId || '';
  warning.close();
  $('#folderName').value = '';
  $('#folderDialog').showModal();
  $('#folderName').focus();
});

$('#movementForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const item = db.items.find((entry) => entry.id === $('#movementForm').dataset.itemId);
  if (!item) return;
  const type = $('#movementType').value;
  const notes = $('#movementNote').value.trim();
  if (type === 'saida') {
    const destination = db.folders.find((folder) => folder.id === $('#movementDestination').value);
    if (!destination) return toast('Escolha uma pasta de destino existente.');
    if (destination.id === item.folderId) return toast('Escolha uma pasta diferente da pasta atual.');
    const source = db.folders.find((folder) => folder.id === item.folderId);
    if (!confirm(`Mover “${item.name}” e suas ${formatNumber(item.codes.length)} unidades de “${source?.name || 'Geral'}” para “${destination.name}”? Os códigos serão mantidos sem alteração.`)) return;
    const oldConditions = { ...(item.conditions || {}) };
    const transfer = transferItemToFolder(item, destination, notes);
    if (!transfer) return toast('Não foi possível mover este item.');
    $('#movementDialog').close();
    if (await saveChanges({ items: [item], folders: true, history: [transfer.event] }, () => {
      item.folderId = transfer.oldFolderId;
      item.conditions = oldConditions;
      destination.statuses = transfer.oldStatuses;
      db.history = db.history.filter((entry) => entry.id !== transfer.event.id);
    })) toast('Item movido; os códigos foram mantidos.');
    return;
  }
  const quantity = Number($('#movementQty').value);
  if (!Number.isInteger(quantity) || quantity < 1) return toast('Informe uma quantidade válida.');
  const oldCodes = [...item.codes];
  const codes = nextCodes(item.prefix, quantity);
  item.codes.push(...codes);
  const folder = db.folders.find((entry) => entry.id === item.folderId);
  const movement = { id: makeId(), type, itemId: item.id, folderId: item.folderId, destinationFolderId: item.folderId, destinationFolderName: folder?.name || 'Geral', itemName: item.name, prefix: item.prefix, folderName: folder?.name || 'Geral', quantity, codes, notes, createdAt: new Date().toISOString() };
  db.history.unshift(movement);
  $('#movementDialog').close();
  if (await saveChanges({ items: [item], history: [movement] }, () => {
    item.codes = oldCodes;
    db.history = db.history.filter((entry) => entry.id !== movement.id);
  })) toast('Entrada registrada.');
});

$('#historyBtn').addEventListener('click', () => { historyPage = 0; renderHistory(); $('#historyDialog').showModal(); });

$('#importBtn').addEventListener('click', () => $('#importDialog').showModal());
$('#chooseImportBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const incoming = normalizeDatabase(JSON.parse(await file.text()));
    if (!confirm(`Importar ${formatNumber(incoming.items.length)} cadastros e substituir o estoque atual?`)) return;
    const previous = db;
    db = incoming;
    rebuildReservedCodes();
    try { await replaceAll(db); }
    catch (error) { db = previous; rebuildReservedCodes(); throw error; }
    activeFolder = 'all';
    currentPage = 0;
    selectedItemIds.clear();
    $('#importDialog').close();
    render();
    void updateStorageInfo();
    toast('Estoque importado.');
  } catch (error) {
    toast('Não foi possível importar. Confira se o arquivo é uma cópia válida.');
  }
});

$('#exportBtn').addEventListener('click', () => {
  const payload = { schemaVersion: 2, exportedAt: new Date().toISOString(), ...db };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'estoque-wtc.json';
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Cópia do estoque exportada.');
});

$('#sheetExportBtn').addEventListener('click', exportInventoryCsv);
$('#exportContinueBtn').addEventListener('click', showExportConfirmation);
$('#exportBackBtn').addEventListener('click', () => {
  $('#exportConfirmStep').hidden = true;
  $('#exportChooseStep').hidden = false;
  $('#exportTitle').textContent = 'Escolha o formato';
  $('#exportSubtitle').textContent = 'Selecione uma pasta e o formato da planilha.';
});
$('#exportConfirmCheck').addEventListener('change', (event) => { $('#exportConfirmBtn').disabled = !event.target.checked; });
$('#exportConfirmBtn').addEventListener('click', () => { if ($('#exportConfirmCheck').checked) void confirmFolderExport(); });

initializeStorage();


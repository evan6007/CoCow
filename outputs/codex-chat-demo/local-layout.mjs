import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';

// Friend devices organize their own display without modifying Codex's live DB.
export class LocalLayout {
  constructor(work) {
    this.path = join(work, 'local-sidebar-layout.json');
    this.data = {projects: {}, threads: {}, order: []};
    try { this.data = {...this.data, ...JSON.parse(readFileSync(this.path, 'utf8'))}; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  save() { writeFileSync(this.path + '.tmp', JSON.stringify(this.data)); renameSync(this.path + '.tmp', this.path); }
  apply(record){return {...record,...this.data.threads[record.id]};}
  catalog(catalog) {
    const order = this.data.order;
    return {...catalog, readOnly: false, localOnly: true, syncNote: '分類與排序保存在這台電腦的 CoCow；不改寫官方 Codex 側欄。',
      data: catalog.data.map(p => ({...p, name: this.data.projects[p.id]?.name || p.name})).sort((a,b) => {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        return (ai < 0 ? 1e6 : ai) - (bi < 0 ? 1e6 : bi);
      })};
  }
  threads(result, archived = false) {
    return {...result, data: result.data.map(t => {
      const override = this.data.threads[t.id] || {};
      return {...t, ...override, ...(Object.hasOwn(override, 'projectId') ? {displayProjectId: override.projectId} : {}),
        ...(Object.hasOwn(override, 'pinned') ? {section: override.pinned ? {name: 'Pinned'} : null} : {})};
    }).filter(t => !!t.archived === archived)};
  }
  project(change, catalog) {
    const ids = catalog.data.map(p => p.id);
    if (!ids.includes(change.id)) throw Error('找不到這台電腦的專案。');
    if (change.action === 'rename') {
      if (typeof change.name !== 'string' || !change.name.trim() || change.name.length > 100) throw Error('專案名稱需為 1–100 字。');
      this.data.projects[change.id] = {name: change.name.trim()};
    } else if (change.action === 'move') {
      if (change.beforeId !== null && (!ids.includes(change.beforeId) || change.beforeId === change.id)) throw Error('目的地專案不正確。');
      const order = this.catalog(catalog).data.map(p => p.id).filter(id => id !== change.id);
      order.splice(change.beforeId === null ? order.length : order.indexOf(change.beforeId), 0, change.id);
      this.data.order = order;
    } else throw Error('不支援的專案操作。');
    this.save(); return {localOnly: true, message: '已保存到這台電腦的 CoCow。'};
  }
  thread(change, record, catalog) {
    if (!record || change.id !== record.id) throw Error('找不到這台電腦的對話。');
    const next = {...this.data.threads[change.id]};
    if (change.action === 'move') {
      if (change.projectId !== null && !catalog.data.some(p => p.id === change.projectId)) throw Error('找不到目的地專案。');
      next.projectId = change.projectId;
      if(change.projectId!==null){const root=catalog.data.find(p=>p.id===change.projectId)?.roots?.[0]?.path;if(!root)throw Error('目的地專案缺少工作區路徑。');next.cwd=root;}
    } else if (change.action === 'rename') {
      if (typeof change.title !== 'string' || !change.title.trim() || change.title.length > 100) throw Error('標題需為 1–100 字。');
      next.title = change.title.trim();
    } else if (['pin','unpin'].includes(change.action)) next.pinned = change.action === 'pin';
    else if (['archive','unarchive'].includes(change.action)) next.archived = change.action === 'archive';
    else throw Error('不支援的對話操作。');
    this.data.threads[change.id] = next;
    this.save(); return {localOnly: true, message: '已保存到這台電腦的 CoCow。'};
  }
}

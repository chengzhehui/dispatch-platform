"""Import a reproducible, standalone diesel history snapshot from three-demo.

Runtime uses only copied tiles, compact EP3D properties and daily JSON files.
The copied source workbook and normalized SQLite snapshot remain in server-data.
"""
import argparse
import collections
from datetime import date, datetime, timedelta
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import unicodedata

import openpyxl


def text(value):
    return '' if value is None else str(value).strip()


def key(*values):
    return '|'.join(re.sub(r'\s+', '', unicodedata.normalize('NFKC', text(v))).upper() for v in values)


def date_text(value):
    if isinstance(value, (date, datetime)):
        return value.strftime('%Y-%m-%d')
    value = text(value)
    if not value:
        return ''
    for fmt in ('%Y/%m/%d', '%Y-%m-%d', '%Y.%m.%d', '%Y/%m/%d %H:%M:%S', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(value, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value).strftime('%Y-%m-%d')
    except ValueError:
        return ''


def cap_welders(value):
    value = text(value)
    if value.upper() in ('', '-', '/', '无', 'NONE', 'NAN', 'NULL'):
        return []
    return sorted(set(v.upper() for v in re.split(r'[,，;；、/+&\s]+', value) if v))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')


def connect(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)


def build(source, target):
    src = source / 'server-data/4d-projects/diesel-4d'
    public = source / 'public/4d-projects/diesel-4d'
    output = target / 'public/data/diesel-history'
    ep3d = target / 'public/data/diesel-ep3d'
    archive = target / 'server-data/diesel-history'
    archive.mkdir(parents=True, exist_ok=True)
    workbook = next((src / 'weld-status/inputs').glob('焊口初始化数据-柴油轻馏分优化利用项目*.xlsx'))
    shutil.copy2(workbook, archive / 'source-welding.xlsx')
    shutil.copytree(public / 'tileset', target / 'public/models/diesel-4d', dirs_exist_ok=True)
    root_path = target / 'public/models/diesel-4d/tileset.json'
    tileset = json.loads(root_path.read_text(encoding='utf-8'))
    tileset['root']['refine'] = 'ADD'  # Independent spatial branches appear progressively.
    write(root_path, tileset)
    tree = json.loads((public / 'data/diesel-4d-model-tree.json').read_text(encoding='utf-8'))
    objects = {}
    for unit in tree['units']:
        for line in unit['lines']:
            for spec in line['specs']:
                for child in spec['children']:
                    objects[child['componentId']] = {'id': child['componentId'], 'unit': unit['label'], 'line': line['label'],
                        'kind': child['label'], 'label': child.get('secondaryLabel', ''), 'isWeld': child.get('isWeld', False)}
    del tree
    model = connect(src / 'model-properties/diesel-4d-model.db')
    geometry_ids = set()
    for parent, gid in model.execute("select pGlid,glid from model_tree where upper(name)='LCOAEXGEOMETRY'"):
        if parent in objects:
            objects[parent].setdefault('geometries', []).append(gid)
            geometry_ids.add(gid)
    model.close()
    bounds_db = connect(src / 'model-properties/diesel-4d-geometry-bounds.db')
    bounds = {row[0]: list(row[1:]) for row in bounds_db.execute('select geometryId,minX,minY,minZ,maxX,maxY,maxZ from geometry_bounds') if row[0] in geometry_ids}
    bounds_db.close()
    for obj in objects.values():
        obj['geometries'] = [gid for gid in obj.get('geometries', []) if gid in bounds]
        boxes = [bounds[gid] for gid in obj['geometries']]
        if boxes:
            b = [*[min(box[i] for box in boxes) for i in range(3)], *[max(box[i] for box in boxes) for i in range(3, 6)]]
            obj['point'] = [(b[i] + b[i + 3]) / 2 for i in range(3)]
            # Legacy bounds are glTF Y-up. Compact EP3D indexes use tileset Z-up.
            obj['bounds'] = [b[0], -b[5], b[1], b[3], -b[2], b[4]]
    del bounds, geometry_ids
    columns, column_ids, properties = [], {}, {}
    attributes = connect(src / 'model-properties/diesel-4d-ep3d.db')
    for component, raw in attributes.execute('select componentGlid,csvRowJson from component_ep3d_row'):
        if component not in objects:
            continue
        row = json.loads(raw)
        pairs = []
        for name, value in row.items():
            if not name.startswith('EP3D_') or not text(value):
                continue
            label = name[5:]
            if label not in column_ids:
                column_ids[label] = len(columns); columns.append({'set': 'EP3D', 'name': label})
            pairs.append([column_ids[label], text(value)])
        properties[component] = pairs
        objects[component]['diameter'] = row.get('EP3D_公称直径', '')
    attributes.close()
    by_unit = collections.defaultdict(list)
    weld_lookup = collections.defaultdict(list)
    for obj in objects.values():
        by_unit[obj['unit']].append(obj)
        if obj['isWeld']:
            weld_lookup[key(obj['unit'], obj['line'], obj['label'])].append(obj)
    all_rows, all_lines, all_line_ids = [], [], {}
    ep_manifest = {'version': 1, 'projectId': 'diesel-4d', 'units': {}}
    for unit, entries in sorted(by_unit.items()):
        lines = list(dict.fromkeys(obj['line'] for obj in entries)); line_ids = {line: i for i, line in enumerate(lines)}
        rows, shards = [], {}
        for i, obj in enumerate(entries):
            shard = i // 1000
            row = [obj['id'], line_ids[obj['line']], obj['kind'], obj['label'], obj['isWeld'], obj['geometries'], obj.get('bounds'), shard, obj.get('diameter', ''), unit]
            rows.append(row)
            shards.setdefault(shard, {})[obj['id']] = properties.get(obj['id'], [])
            if obj['line'] not in all_line_ids:
                all_line_ids[obj['line']] = len(all_lines); all_lines.append(obj['line'])
            all_rows.append([row[0], all_line_ids[obj['line']], *row[2:]])
        for shard, data in shards.items():
            write(ep3d / unit / f'properties-{shard}.json', data)
        write(ep3d / unit / 'index.json', {'version': 1, 'lines': lines, 'columns': columns, 'objects': rows})
        ep_manifest['units'][unit] = {'url': f'/data/diesel-ep3d/{unit}/index.json', 'components': len(rows), 'welds': sum(row[4] for row in rows), 'locatableWelds': sum(bool(row[4] and row[6]) for row in rows)}
    write(ep3d / 'ALL/index.json', {'version': 1, 'lines': all_lines, 'columns': columns, 'objects': all_rows})
    ep_manifest['units']['ALL'] = {'url': '/data/diesel-ep3d/ALL/index.json', 'components': len(all_rows), 'welds': sum(row[4] for row in all_rows), 'locatableWelds': sum(bool(row[4] and row[6]) for row in all_rows)}
    write(ep3d / 'manifest.json', ep_manifest)
    del properties, all_rows
    area_lookup = {}
    area_source = src / 'weld-status/inputs/diesel-4d-work-area-welds.xlsx'
    if area_source.exists():
        book = openpyxl.load_workbook(area_source, read_only=True, data_only=True)
        rows = book['焊口归属'].iter_rows(values_only=True); headers = next(rows)
        for values in rows:
            row = dict(zip(headers, values))
            area_lookup[key(row.get('单元号'), row.get('管线号'), row.get('焊口号'))] = f"{text(row.get('工区类型'))} · {text(row.get('工区编号'))}"
        book.close()
    book = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    rows = book.active.iter_rows(values_only=True); codes = next(rows); headers = next(rows)
    records, audit = {}, collections.Counter()
    for source_row, values in enumerate(rows, 3):
        if not any(values): continue
        row = dict(zip(headers, values)); data_id = text(row.get('数据ID(不可修改)')) or f'row:{source_row}'
        audit['sourceRows'] += 1
        if data_id in records:
            audit['duplicateDataIds'] += 1
            old = records[data_id]
            if (text(row.get('修改时间(必填)')), source_row) < (text(old[1].get('修改时间(必填)')), old[0]): continue
        records[data_id] = (source_row, row)
    book.close()
    database = archive / 'welding.db'
    db = sqlite3.connect(database)
    db.executescript('drop table if exists weld_records; drop table if exists metadata; create table metadata(key text primary key,value text); create table weld_records(source_id text primary key,source_row integer,unit text,line text,initial_weld text,final_weld text,weld_date text,cap_welders_json text,location_status text,point_json text,component_ids_json text,work_area text,raw_json text); create index weld_date_idx on weld_records(weld_date);')
    daily = collections.defaultdict(list)
    unit_counts = collections.Counter()
    for source_id, (source_row, row) in records.items():
        unit, line = text(row.get('单元号(必填)')), text(row.get('管线号(必填)'))
        final, initial = text(row.get('最终焊口号')), text(row.get('初始焊口号'))
        weld_date, welders = date_text(row.get('盖面日期')), cap_welders(row.get('盖面'))
        matches, method = [], 'unmatched'
        for number, label in ((final, 'final'), (initial, 'initial')):
            if number and weld_lookup.get(key(unit, line, number)):
                matches = [obj for obj in weld_lookup[key(unit, line, number)] if obj.get('point')]
                method = label
                if matches: break
        if len(matches) > 1 and max(math.dist(matches[0]['point'], obj['point']) for obj in matches) > .25:
            matches, method = [], 'ambiguous'
        point = matches[0]['point'] if matches else None
        component_ids = [obj['id'] for obj in matches]
        location = method if point else ('ambiguous' if method == 'ambiguous' else 'unmatched')
        work_area = area_lookup.get(key(unit, line, final)) or area_lookup.get(key(unit, line, initial)) or f'{unit} · 未分配工区'
        event = {'id': source_id, 'sourceRow': source_row, 'unit': unit, 'line': line, 'weld': final or initial, 'initialWeld': initial,
                 'date': weld_date, 'welders': welders, 'point': point, 'componentIds': component_ids, 'location': location,
                 'workArea': work_area, 'diameter': matches[0].get('diameter', '') if matches else '', 'area': text(row.get('焊接区域'))}
        db.execute('insert into weld_records values(?,?,?,?,?,?,?,?,?,?,?,?,?)', (source_id, source_row, unit, line, initial, final, weld_date,
                   json.dumps(welders), location, json.dumps(point), json.dumps(component_ids), work_area, json.dumps(row, ensure_ascii=False, default=str)))
        audit['uniqueRecords'] += 1
        if row.get('盖面日期') and not weld_date: audit['invalidDates'] += 1
        if weld_date:
            daily[weld_date].append(event); audit['datedRecords'] += 1
            if not welders: audit['datedMissingWelder'] += 1
            if welders and point: audit['locatedWithWelder'] += 1
            elif welders: audit['unlocatedWithWelder'] += 1
            unit_counts[unit] += 1
    summaries = {}
    for day, events in sorted(daily.items()):
        write(output / f'days/{day}.json', {'date': day, 'records': events})
        workers = {w for event in events for w in event['welders']}
        located = {w for event in events if event['point'] for w in event['welders']}
        summaries[day] = {'date': day, 'welds': len(events), 'workers': len(workers), 'locatedWelds': sum(bool(event['point']) for event in events), 'locatedWorkers': len(located), 'missingWelder': sum(not event['welders'] for event in events)}
    dates = sorted(daily)
    days = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days
    calendar = [(date.fromisoformat(dates[0]) + timedelta(days=i)).isoformat() for i in range(days + 1)]
    root_box = json.loads((public / 'tileset/tileset.json').read_text())['root']['boundingVolume']['box']
    manifest = {'version': 1, 'projectId': 'diesel-4d', 'name': '柴油轻馏分优化利用项目', 'modelUrl': '/models/diesel-4d/tileset.json',
                'modelBox': root_box, 'units': sorted(set(by_unit) | set(unit_counts)), 'dates': calendar, 'daily': summaries,
                'initialDate': max(summaries, key=lambda d: (summaries[d]['locatedWorkers'], d)), 'audit': dict(audit),
                'source': {'workbook': 'server-data/diesel-history/source-welding.xlsx', 'database': 'server-data/diesel-history/welding.db',
                           'sha256': hashlib.sha256(workbook.read_bytes()).hexdigest(), 'dateField': '盖面日期', 'welderField': '盖面'},
                'rules': {'dedupe': '数据ID去重，保留最新修改记录；无ID使用源行号', 'match': '单元+管线+最终焊口号，失败后初始号；相距超过0.25m的重名节点不猜测',
                          'playback': '严格按设定日时长播放；每秒最多演示1道已定位焊口，行走计入演示时段，多余焊口未演示但保留台账统计；无日内时间，先后顺序仅为示意'}}
    write(output / 'manifest.json', manifest)
    db.execute('insert into metadata values(?,?)', ('manifest', json.dumps(manifest, ensure_ascii=False)))
    db.commit(); db.close()
    print(json.dumps({'audit': dict(audit), 'dates': [dates[0], dates[-1]], 'days': len(dates), 'initialDate': manifest['initialDate'], 'initial': summaries[manifest['initialDate']]}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('../three-demo'))
    parser.add_argument('--target', type=Path, default=Path('.'))
    args = parser.parse_args()
    build(args.source.resolve(), args.target.resolve())

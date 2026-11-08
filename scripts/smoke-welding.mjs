import { browserLaunchOptions } from './browser-options.mjs'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'

fs.mkdirSync('artifacts', { recursive: true })
const browser = await chromium.launch(browserLaunchOptions)
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } })
page.setDefaultTimeout(60000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`) })
const engine = `document.getElementById('app').__vue_app__._instance.setupState.engine`
const read = expression => page.evaluate(`(() => {const e=${engine};return (${expression})})()`)
const run = code => page.evaluate(`(() => {const e=${engine};${code}})()`)
const wait = expression => page.waitForFunction(`(() => {const e=${engine};return e && (${expression})})()`, null, { timeout: 90000 })

async function actualWeldPixel(id) {
  return read(`(() => {
    const object=e.ep3d.getObject(e.unit,'${id}'), candidates=[],rect=e.host.getBoundingClientRect();
    e.camera.updateMatrixWorld();
    for(const record of e.ep3d.meshRecords.values()){
      let parent=record.mesh;while(parent&&parent!==e.tiles.group)parent=parent.parent;if(!parent)continue;
      const geometry=record.mesh.geometry, index=geometry.getIndex(),position=geometry.attributes.position;
      for(const geometryId of object.geometryIds)for(const [start,end] of e.ep3d.indexRanges(record).get(geometryId)||[]){
        for(let offset=start;offset<end;offset+=3){
          const vertices=[0,1,2].map(n=>record.mesh.localToWorld(e.camera.position.clone().fromBufferAttribute(position,index?index.getX(offset+n):offset+n)));
          const center=vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1/3).project(e.camera);
          if(center.z<=-1||center.z>=1||Math.abs(center.x)>.95||Math.abs(center.y)>.95)continue;
          const screenX=Math.round(rect.x+(center.x+1)/2*rect.width),screenY=Math.round(rect.y+(1-center.y)/2*rect.height);
          e.pointer.set((screenX-rect.x)/rect.width*2-1,-(screenY-rect.y)/rect.height*2+1);e.raycaster.setFromCamera(e.pointer,e.camera);
          if(e.ep3d.pick(e.raycaster,e.tiles.group)?.object.id!==object.id)continue;
          const projected=vertices.map(v=>v.project(e.camera));
          const area=Math.abs((projected[1].x-projected[0].x)*(projected[2].y-projected[0].y)-(projected[2].x-projected[0].x)*(projected[1].y-projected[0].y));
          candidates.push({x:screenX,y:screenY,area});
        }
      }
    }
    return candidates.sort((a,b)=>b.area-a.area)[0]||null;
  })()`)
}

try {
  await page.goto('http://localhost:5188')
  await wait('e.workers.length === 12 && e.ep3d.state().ready')
  assert.equal(await read('e.ep3d.state().componentCount'), 70820)
  const fixture = await read(`(() => {const o=e.ep3d.cache.get('213').welds.find(o=>o.geometryIds.length===3&&((o.bounds[2]+o.bounds[5])/2-e.site.groundElevation)>.25&&((o.bounds[2]+o.bounds[5])/2-e.site.groundElevation)<.85);return {id:o.id,label:o.label,line:o.line}})()`)
  await page.getByLabel('今日焊工人数').fill('2')
  await page.getByRole('button', { name: '设置人数', exact: true }).click()
  await page.getByRole('button', { name: '焊缝与属性', exact: true }).click()
  await page.getByLabel('搜索结构树').fill(`${fixture.line} ${fixture.label}`)
  await page.getByRole('button', { name: `定位焊缝 ${fixture.label} ${fixture.id}`, exact: true }).click()
  await wait(`e.ep3d.selected?.id==='${fixture.id}'&&!e.ep3d.selected.loading`)
  assert.equal(await read(`e.ep3d.selected.properties.find(row=>row.name==='焊点编号').value`), fixture.label)
  assert.equal(await read('e.ep3d.selected.geometryIds.length'), 3)
  assert.equal(await read('e.showDesignModels'), false)
  await wait(`(() => {const ids=new Set();for(const r of e.ep3d.meshRecords.values()){let p=r.mesh;while(p&&p!==e.tiles.group)p=p.parent;if(p&&r.overlay)for(const id of r.ranges.keys())if(e.ep3d.selected.geometryIds.includes(id))ids.add(id)}return ids.size===3})()`)
  assert.equal(await page.locator('.ep3d-properties').evaluate(element => element.open), true)
  await page.screenshot({ path: 'artifacts/ep3d-properties.png' })
  console.log('PASS: standalone EP3D index, lazy properties, source weld identity and all three geometry highlights')

  await page.locator('.roster button').first().click()
  await page.getByRole('button', { name: '关闭焊缝面板', exact: true }).click()
  await page.locator('.simulation-controls select').selectOption('60')
  let pixel = null
  for (let attempt=0; attempt<4 && !pixel; attempt++) { await page.waitForTimeout(700); pixel=await actualWeldPixel(fixture.id) }
  assert.ok(pixel, 'a visible real weld triangle must be pickable')
  await page.mouse.click(pixel.x, pixel.y)
  await wait(`e.workers[0].weldTask?.weldId==='${fixture.id}'`)
  assert.equal(await read('e.workers[0].weldTask.status'), 'approaching')
  await page.locator('.roster button').nth(1).click()
  assert.equal(await page.getByRole('button', { name: '已绑定 W-001', exact: true }).isDisabled(), true)
  assert.equal(await read(`e.bindSelectedToWeld('${fixture.id}')`), false)
  assert.equal(await read('e.workers[1].weldTask || null'), null)
  await page.locator('.roster button').first().click()
  await wait('e.workers[0].weldTask?.status === "welding" && e.workers[0].weldTask.elapsed > .8')
  assert.equal(await read('e.workers[0].visual.welding.tools.visible'), true)
  assert.equal(await read('e.workers[0].weldTask.crouch'), true)
  assert.equal(await read('e.moveEffects.orders.size'), 0)
  const beforeRepeat = await read('e.workers[0].weldTask.elapsed')
  await read(`e.bindSelectedToWeld('${fixture.id}')`)
  assert.ok(await read('e.workers[0].weldTask.elapsed') >= beforeRepeat)
  const handBefore = await read(`(() => {let q; e.workers[0].visual.model.traverse(o=>{if(o.isBone&&o.name.toLowerCase().replace(/[^a-z]/g,'')==='lowerarml')q=o.quaternion.toArray()});return q})()`)
  await page.waitForTimeout(300)
  const handAfter = await read(`(() => {let q; e.workers[0].visual.model.traverse(o=>{if(o.isBone&&o.name.toLowerCase().replace(/[^a-z]/g,'')==='lowerarml')q=o.quaternion.toArray()});return q})()`)
  assert.notDeepEqual(handBefore,handAfter)
  await run(`const t=e.workers[0].weldTask,s=t.station,f=e.camera.position.clone().set(Math.sin(t.heading),0,Math.cos(t.heading)),side=e.camera.position.clone().set(-f.z,0,f.x);e.controls.target.set(s[0],s[1]+.9,s[2]);e.camera.position.set(s[0]-side.x*3.4+f.x*.4,s[1]+2.5,s[2]-side.z*3.4+f.z*.4);e.controls.update()`)
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'artifacts/welder-working.png' })
  console.log('PASS: real model click assigns worker, duplicate ownership prevented, approach-to-weld transition and visible looping pose/tools')

  await page.getByRole('button', { name: '暂停移动', exact: true }).click()
  const elapsed = await read('e.workers[0].weldTask.elapsed')
  await page.waitForTimeout(300)
  assert.equal(await read('e.workers[0].weldTask.elapsed'), elapsed)
  await wait('e.tiles.stats.queued===0 && e.tiles.stats.downloading===0 && e.tiles.stats.parsing===0')
  await page.reload()
  await wait(`e.workers.length===2&&e.workers[0].weldTask?.weldId==='${fixture.id}'&&e.workers[0].visual.welding.tools.visible`)
  assert.ok(await read('e.workers[0].weldTask.elapsed') >= elapsed)
  await page.locator('.roster button').first().click()
  await page.getByRole('button', { name: '焊工视角', exact: true }).click()
  await page.keyboard.down('w'); await page.waitForTimeout(180); await page.keyboard.up('w')
  assert.equal(await read('e.workers[0].weldTask'), null)
  assert.equal(await read('e.workers[0].visual.welding.tools.visible'), false)
  await page.keyboard.press('Escape')
  await page.locator('.roster button').first().click()
  await run(`e.selectComponent('${fixture.id}')`)
  await page.getByRole('button', { name: '绑定并前往焊缝', exact: true }).click()
  await wait('e.workers[0].weldTask?.status==="welding"')
  await page.getByRole('button', { name: '停止作业', exact: true }).click()
  assert.equal(await read('e.workers[0].weldTask'), null)
  await wait('!e.workers[0].visual.welding.tools.visible')
  console.log('PASS: pause, persisted weld binding, manual takeover and explicit stop release')

  await page.locator('.unit-row').filter({has:page.locator('strong',{hasText:/^27$/})}).click()
  await wait('e.unit==="27"&&!e.ep3d.loading')
  assert.equal(await read('e.ep3d.state().available'), false)
  assert.equal(await read('e.showDesignModels'), true)
  await page.getByText('27 单元当前只有设计模型', { exact: false }).waitFor()
  await page.locator('.unit-row').filter({has:page.locator('strong',{hasText:/^213$/})}).click()
  await wait('e.unit==="213"&&e.ep3d.state().ready')
  await run(`e.focusComponent('${fixture.id}')`)
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(250)
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await page.screenshot({path:'artifacts/welding-mobile.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS: design-only unit handling and mobile property panel; no runtime/resource errors')
} catch (error) { await page.screenshot({path:'artifacts/welding-failure.png'}); console.log('STATE',await read('({selected:e.ep3d.selected?.id,crew:[...e.selected],task:e.workers[0]?.weldTask})'));throw error } finally { await browser.close() }

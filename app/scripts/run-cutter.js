#!/usr/bin/env node
/**
 * run-cutter.js
 *
 * a_creative_cutter.html의 핵심 로직(기존 클립 복제 + 켄번스 키프레임 생성)을
 * 브라우저 없이 Node에서 그대로 실행하는 헤드리스 버전.
 * capcut-web-automation.js(웹버전)와는 무관 — CapCut 데스크톱 프로젝트의
 * draft_content.json을 직접 읽고 써서 컷을 배치한다.
 *
 * 전제조건: draft_content.json의 video 트랙에 기존 클립이 최소 1개 있어야 함
 * (그 클립을 템플릿으로 복제해서 새 컷들을 만듦 — CapCut에서 직접 추가해둘 것).
 *
 * Usage:
 *   node scripts/run-cutter.js <epNum>
 */
import fs from 'node:fs'
import path from 'node:path'

const MEDIA_ROOT = 'C:\\yeori-studio'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16).toUpperCase()
  })
}

function makeKenBurns(duration, effectType) {
  const end = duration - 133333
  const effects = {
    zoomIn:      { scaleStart: 1.1,  scaleEnd: 1.35, xStart: 0,     xEnd: 0,     yStart: 0,     yEnd: 0 },
    zoomOut:     { scaleStart: 1.35, scaleEnd: 1.1,  xStart: 0,     xEnd: 0,     yStart: 0,     yEnd: 0 },
    leftToRight: { scaleStart: 1.3,  scaleEnd: 1.3,  xStart: -0.08, xEnd: 0.08,  yStart: 0,     yEnd: 0 },
    rightToLeft: { scaleStart: 1.3,  scaleEnd: 1.3,  xStart: 0.08,  xEnd: -0.08, yStart: 0,     yEnd: 0 },
    topToBottom: { scaleStart: 1.3,  scaleEnd: 1.3,  xStart: 0,     xEnd: 0,     yStart: -0.08, yEnd: 0.08 },
    bottomToTop: { scaleStart: 1.3,  scaleEnd: 1.3,  xStart: 0,     xEnd: 0,     yStart: 0.08,  yEnd: -0.08 },
  }
  const e = effects[effectType] || effects.zoomIn
  const kf = (time, value) => ({
    id: uuid(), curveType: 'Line', time_offset: time,
    left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 },
    values: [value], string_value: '', graphID: '',
  })
  return [
    { id: uuid(), material_id: '', property_type: 'KFTypePositionX', keyframe_list: [kf(133333, e.xStart), kf(end, e.xEnd)] },
    { id: uuid(), material_id: '', property_type: 'KFTypePositionY', keyframe_list: [kf(133333, e.yStart), kf(end, e.yEnd)] },
    { id: uuid(), material_id: '', property_type: 'KFTypeScaleX',    keyframe_list: [kf(133333, e.scaleStart), kf(end, e.scaleEnd)] },
    { id: uuid(), material_id: '', property_type: 'KFTypeScaleY',    keyframe_list: [kf(133333, e.scaleStart), kf(end, e.scaleEnd)] },
    { id: uuid(), material_id: '', property_type: 'KFTypeRotation',  keyframe_list: [kf(133333, 0.0)] },
  ]
}

const kenBurnsEffects = ['zoomIn', 'zoomOut', 'leftToRight', 'rightToLeft', 'topToBottom', 'bottomToTop']

// cutter_input.json의 kenburns 값 → 내부 효과 id
const kbMap = {
  none: 'none', random: 'random',
  zoom_in: 'zoomIn', zoom_out: 'zoomOut',
  pan_left: 'rightToLeft', pan_right: 'leftToRight',
  pan_up: 'bottomToTop', pan_down: 'topToBottom',
}

function makeSegAndMaterials(d, r, tmplSeg, folderPath, kbMode) {
  const fullPath = folderPath ? folderPath.replace(/[/\\]+$/, '') + '/' + r.file : r.file

  const matId = uuid(), spdId = uuid(), phId = uuid(), cvId = uuid(), scmId = uuid(), mcId = uuid(), vsId = uuid()
  const isVideo = /\.(mp4|mov|webm)$/i.test(r.file)

  d.materials.videos.push({
    id: matId, unique_id: '', type: isVideo ? 'video' : 'photo', duration: 10800000000,
    path: fullPath, media_path: '', local_id: '', has_audio: isVideo,
    reverse_path: '', intensifies_path: '', reverse_intensifies_path: '',
    intensifies_audio_path: '', cartoon_path: '',
    width: 2752, height: 1536,
    category_id: '', category_name: '', material_id: '',
    material_name: r.file.replace(/^\d+[_\s]*/, ''), material_url: '',
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1.0, extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false },
    source: 0, source_platform: 0, formula_id: '', check_flag: 62978047,
    video_algorithm: { algorithms: [], time_range: null, path: '', gameplay_configs: [], ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null, deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null, ai_background_configs: [], smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null, story_video_modify_video_config: { task_id: '', is_overwrite_last_video: false, tracker_task_id: '' }, skip_algorithm_index: [] },
    is_unified_beauty_mode: false, object_locked: null, smart_motion: null, multi_camera_info: null, freeze: null,
    picture_from: 'none', picture_set_category_id: '', picture_set_category_name: '', team_id: '',
    local_material_id: '', origin_material_id: '', request_id: '',
    has_sound_separated: false, is_text_edit_overdub: false, is_ai_generate_content: false,
    aigc_type: 'none', is_copyright: false, aigc_history_id: '', aigc_item_id: '', local_material_from: '',
    smart_match_info: null, beauty_face_preset_infos: [], beauty_body_preset_id: '',
    beauty_face_auto_preset: { preset_id: '', name: '', rate_map: '', scene: '' },
    beauty_face_auto_preset_infos: [], beauty_body_auto_preset: null,
    live_photo_timestamp: -1, live_photo_cover_path: '', content_feature_info: null, corner_pin: null, surface_trackings: [],
    video_mask_stroke: { resource_id: '', path: '', type: '', color: '', size: 0, alpha: 0, distance: 0, texture: 0, horizontal_shift: 0, vertical_shift: 0 },
    video_mask_shadow: { resource_id: '', path: '', color: '', alpha: 0, blur: 0, distance: 0, angle: 0 },
  })

  d.materials.speeds.push({ id: spdId, type: 'speed', mode: 0, speed: 1.0, curve_speed: null })
  d.materials.placeholder_infos.push({ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' })
  d.materials.canvases.push({ id: cvId, type: 'canvas_color', color: '', blur: 0, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' })
  d.materials.sound_channel_mappings.push({ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false })
  d.materials.material_colors.push({ id: mcId, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90, width: 0, height: 0 })
  d.materials.vocal_separations.push({ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' })

  const seg = JSON.parse(JSON.stringify(tmplSeg))
  seg.id = uuid()
  seg.material_id = matId
  seg.source_timerange = { start: 0, duration: r.duration }
  seg.target_timerange = { start: r.start, duration: r.duration }
  seg.extra_material_refs = [spdId, phId, cvId, scmId, mcId, vsId]

  let effectType = 'none'
  if (kbMode !== 'none') {
    effectType = kbMode === 'random'
      ? kenBurnsEffects[Math.floor(Math.random() * kenBurnsEffects.length)]
      : kbMode
    seg.common_keyframes = makeKenBurns(r.duration, effectType)
  } else {
    seg.common_keyframes = []
  }
  return { seg, effectType }
}

function run(epNum) {
  const cutterInputPath = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${epNum}`, 'cutter_input.json')
  if (!fs.existsSync(cutterInputPath)) {
    throw new Error(`cutter_input.json 없음: ${cutterInputPath}`)
  }
  const cutterInput = JSON.parse(fs.readFileSync(cutterInputPath, 'utf-8'))

  const kbMode = kbMap[cutterInput.kenburns] || 'random'
  console.log(`[cutter] 켄번스 모드: ${cutterInput.kenburns} → ${kbMode}`)

  if (!cutterInput.draft || !fs.existsSync(cutterInput.draft)) {
    throw new Error(`draft_content.json 없음: ${cutterInput.draft}`)
  }
  const d = JSON.parse(fs.readFileSync(cutterInput.draft, 'utf-8'))
  const videoTrack = d.tracks.find(t => t.type === 'video')
  if (!videoTrack) throw new Error('video 트랙을 찾을 수 없습니다')
  if (!videoTrack.segments[0]) {
    throw new Error('video 트랙에 기존 클립이 없습니다. CapCut에서 이 프로젝트를 열어 클립을 1개 추가한 뒤 다시 시도하세요.')
  }
  const tmplSeg = JSON.parse(JSON.stringify(videoTrack.segments[0]))

  if (!cutterInput.editMeta || !fs.existsSync(cutterInput.editMeta)) {
    throw new Error(`editMeta 없음: ${cutterInput.editMeta}`)
  }
  const editMeta = JSON.parse(fs.readFileSync(cutterInput.editMeta, 'utf-8'))
  const cuts = Array.isArray(editMeta) ? editMeta : []
  if (cuts.length === 0) throw new Error('editMeta에 컷이 없습니다')

  const matchResult = cuts.map(m => ({
    cutNo: m.cutNo,
    label: m.label || `CUT ${m.cutNo}`,
    file: `cut_${String(m.cutNo).padStart(2, '0')}.mp4`,
    start: Math.round((m.startSec || 0) * 1000000),
    end: Math.round((m.endSec || 0) * 1000000),
    duration: Math.round(((m.endSec || 0) - (m.startSec || 0)) * 1000000),
  }))

  const folderPath = `C:/yeori-studio/downloads/video/ep${epNum}`

  // 전체 모드: 기존 세그먼트/소재 전부 비우고 editMeta 기준으로 재구성
  videoTrack.segments = []
  d.materials.videos = []
  d.materials.speeds = []
  d.materials.placeholder_infos = []
  d.materials.canvases = []
  d.materials.sound_channel_mappings = []
  d.materials.material_colors = []
  d.materials.vocal_separations = []

  const cutDetails = []
  for (const r of matchResult) {
    const { seg, effectType } = makeSegAndMaterials(d, r, tmplSeg, folderPath, kbMode)
    videoTrack.segments.push(seg)
    cutDetails.push({
      cutNo: r.cutNo, label: r.label, file: r.file,
      startSec: r.start / 1000000, endSec: r.end / 1000000,
      durationSec: r.duration / 1000000, kenburns: effectType,
    })
  }
  d.duration = matchResult.reduce((max, r) => Math.max(max, r.end), 0)

  fs.writeFileSync(cutterInput.draft, JSON.stringify(d), 'utf-8')
  const projectName = path.basename(path.dirname(cutterInput.draft))
  console.log(`✅ 커터 실행 완료: ${matchResult.length}개 컷, duration=${d.duration}`)
  console.log(`   → 프로젝트: ${projectName} (${cutterInput.draft})`)

  const result = { segCount: matchResult.length, durationSec: Math.round(d.duration / 1000000), draftPath: cutterInput.draft, projectName, cuts: cutDetails }
  // proxy.js가 stdout에서 파싱해 프론트엔드에 결과를 그대로 전달할 수 있도록
  // 마지막 줄에 기계 판독 가능한 요약을 남김
  console.log(`RESULT_JSON:${JSON.stringify(result)}`)
  return result
}

const epNum = process.argv[2]
if (!epNum) {
  console.error('❌ 사용법: node scripts/run-cutter.js <epNum>')
  process.exit(1)
}

try {
  run(epNum)
} catch (err) {
  console.error(`❌ 오류: ${err.message}`)
  process.exit(1)
}

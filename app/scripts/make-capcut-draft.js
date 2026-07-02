#!/usr/bin/env node
// scripts/make-capcut-draft.js
// G5 편집 자동화 — ep{N}_raw.mp4 + ep{N}.srt → CapCut draft_content.json 생성
// Usage: node scripts/make-capcut-draft.js --ep=5
//
// 사전 조건:
//   1. /api/concat-video 실행 → output/ep{N}/ep{N}_raw.mp4
//   2. /api/generate-srt  실행 → audio/ep{N}/ep{N}.srt
//   3. downloads/video/capcut_project_path.txt → draft_content.json 절대 경로

import fs   from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const MEDIA_ROOT = 'C:\\yeori-studio'
const FFPROBE    = 'ffprobe'

// ── UUID ─────────────────────────────────────────────────────
function uid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16).toUpperCase()
  })
}

const μs = (sec) => Math.round(sec * 1_000_000)

// ── ffprobe 길이 측정 ─────────────────────────────────────────
function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ])
    let out = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve(parseFloat(out.trim()) || 0)
      else reject(new Error(`ffprobe 실패 (code ${code}): ${filePath}`))
    })
    proc.on('error', err => reject(new Error(`ffprobe 실행 오류: ${err.message}`)))
  })
}

// ── SRT 파서 ─────────────────────────────────────────────────
function srtTimeToSec(t) {
  const [hms, ms] = t.split(',')
  const [h, m, s] = hms.split(':').map(Number)
  return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000
}

function parseSRT(content) {
  const blocks = content.trim().split(/\n\n+/)
  return blocks.flatMap(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const tcLine = lines.find(l => l.includes('-->'))
    if (!tcLine) return []
    const m = tcLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/)
    if (!m) return []
    const tcIdx = lines.indexOf(tcLine)
    const text = lines.slice(tcIdx + 1).join(' ').trim()
    if (!text) return []
    return [{ startSec: srtTimeToSec(m[1]), endSec: srtTimeToSec(m[2]), text }]
  })
}

// ── 보조 material 팩토리 ─────────────────────────────────────
const mkSpeed    = (id) => ({ id, type: 'speed', mode: 0, speed: 1.0, curve_speed: null })
const mkCanvas   = (id) => ({ id, type: 'canvas_color', color: '', blur: 0.0, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' })
const mkSoundCh  = (id) => ({ id, type: 'none', audio_channel_mapping: 0, is_config_open: false })
const mkMatColor = (id) => ({ id, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90.0, width: 0.0, height: 0.0 })
const mkVocalSep = (id) => ({ id, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' })
const mkPhInfo   = (id) => ({ id, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' })

// ── 비디오 material ───────────────────────────────────────────
function mkVideoMat(id, localId, filePath, durSec, name) {
  return {
    id, unique_id: '', type: 'video',
    duration: μs(durSec),
    path: filePath.replace(/\\/g, '/'),
    media_path: '', local_id: '',
    has_audio: false,
    reverse_path: '', intensifies_path: '', reverse_intensifies_path: '',
    intensifies_audio_path: '', cartoon_path: '',
    width: 720, height: 1280,
    category_id: '', category_name: 'local',
    material_id: '', material_name: name, material_url: '',
    crop: { upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0, lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1.0, extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false, is_clould: false, mask_video_path: '', cloud_product_fps: 0.0 },
    source: 0, source_platform: 0, formula_id: '', check_flag: 62978047,
    video_algorithm: {
      algorithms: [], time_range: null, path: '', gameplay_configs: [],
      ai_in_painting_config: [], complement_frame_config: null,
      motion_blur_config: null, deflicker: null, noise_reduction: null,
      quality_enhance: null, super_resolution: null, ai_background_configs: [],
      smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [],
      mouth_shape_driver: null,
      ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null,
      story_video_modify_video_config: { task_id: '', is_overwrite_last_video: false, tracker_task_id: '' },
      skip_algorithm_index: [],
    },
    is_unified_beauty_mode: false, is_set_beauty_mode: false,
    object_locked: null, smart_motion: null, multi_camera_info: null,
    freeze: null, picture_from: 'none',
    picture_set_category_id: '', picture_set_category_name: '',
    team_id: '', local_material_id: localId,
    origin_material_id: '', request_id: '',
    has_sound_separated: false, is_text_edit_overdub: false,
    is_ai_generate_content: false, aigc_type: 'none',
    is_copyright: false, aigc_history_id: '', aigc_item_id: '',
    local_material_from: '', smart_match_info: null,
    beauty_face_preset_infos: [], beauty_body_preset_id: '',
    beauty_face_auto_preset: { preset_id: '', name: '', rate_map: '', scene: '' },
    beauty_face_auto_preset_infos: [], beauty_body_auto_preset: null,
    live_photo_timestamp: -1, live_photo_cover_path: '',
    content_feature_info: null, corner_pin: null, surface_trackings: [],
    video_mask_stroke: { resource_id: '', path: '', type: '', color: '', size: 0.0, alpha: 0.0, distance: 0.0, texture: 0.0, horizontal_shift: 0.0, vertical_shift: 0.0 },
    video_mask_shadow: { resource_id: '', path: '', color: '', alpha: 0.0, blur: 0.0, distance: 0.0, angle: 0.0 },
  }
}

// ── 비디오 세그먼트 ───────────────────────────────────────────
function mkVideoSeg(startSec, durSec, matId, extraRefs, keyframeRefs = []) {
  return {
    id: uid(),
    source_timerange: { start: 0,            duration: μs(durSec) },
    target_timerange: { start: μs(startSec), duration: μs(durSec) },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1.0, is_loop: false, is_tone_modify: false,
    reverse: false, intensifies_audio: false, cartoon: false,
    volume: 1.0, last_nonzero_volume: 1.0,
    clip: { scale: { x: 1.0, y: 1.0 }, rotation: 0.0, transform: { x: 0.0, y: 0.0 }, flip: { vertical: false, horizontal: false }, alpha: 1.0 },
    uniform_scale: { on: true, value: 1.0 },
    material_id: matId,
    extra_material_refs: extraRefs,
    render_index: 0, keyframe_refs: keyframeRefs,
    enable_lut: true, enable_adjust: true, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index: 0,
    hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
    enable_color_wheels: true, track_attribute: 0,
    is_placeholder: false, template_id: '',
    enable_smart_color_adjust: false, template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '', lyric_keyframes: null,
    enable_video_mask: true, digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false, enable_color_adjust_pro: false,
  }
}

// ── 텍스트 material (자막) ────────────────────────────────────
function mkTextMat(id, text) {
  return {
    id,
    add_type: 0, adjust_alpha: 0.0,
    background_alpha: 0.75, background_color: '#000000',
    background_height: 0.14, background_horizontal_offset: 0.0,
    background_round_radius: 0.0, background_style: 0,
    background_vertical_offset: 0.0, background_width: 0.82,
    base_content: '', bold_width: 0.0,
    border_alpha: 1.0, border_color: '#000000', border_width: 0.06,
    check_flag: 7,
    combo_info: { text_templates: [] },
    content: text,
    fixed_height: -1.0, fixed_width: -1.0,
    font_alpha: 1.0, font_color: '#FFFFFF', font_color_changed: true,
    font_id: '', font_name: '', font_path: '', font_size: 8.0,
    font_style: '', font_title: '', font_url: '', fonts: [],
    force_apply_line_max_width: false,
    global_alpha: 1.0, group_id: '',
    has_shadow: false, initial_scale: 1.0, inner_padding: -1.0,
    is_combine: false, is_lyric: false, is_range_style: false,
    italic: false, letter_spacing: 0.0, line_feed: 1,
    line_max_width: 0.82, line_spacing: 0.02,
    multi_language_current: 'none', name: '', original_size: [],
    preset_id: '', recognize_task_id: '', recognize_type: 0,
    relevance_segment: [],
    shape_clip_x: false, shape_clip_y: false, source_from: '',
    style_name: '', sub_type: '', subtitle_keywords: null,
    subtitle_template_original_fontsize: 0.0,
    text_alpha: 1.0, text_color: '#FFFFFF', text_curve: null,
    text_preset_resource_id: '', text_size: 8.0,
    text_to_audio_ids: [], tts_auto_update: false,
    type: 'text', typesetting: 0,
    underline: false, underline_offset: 0.22, underline_width: 0.05,
    use_effect_default_color: true,
    words: { end_time: 0, start_time: 0, use_default_content: true, word_infos: [] },
  }
}

// ── 텍스트 세그먼트 (하단 10% 위치) ─────────────────────────
function mkTextSeg(startSec, durSec, matId) {
  return {
    id: uid(),
    source_timerange: { start: 0,            duration: μs(durSec) },
    target_timerange: { start: μs(startSec), duration: μs(durSec) },
    material_id: matId,
    extra_material_refs: [],
    render_index: 11000,
    visible: true, volume: 1.0, speed: 1.0,
    is_loop: false, reverse: false,
    uniform_scale: { on: true, value: 1.0 },
    clip: { scale: { x: 1.0, y: 1.0 }, rotation: 0.0, transform: { x: 0.0, y: -0.8 }, flip: { vertical: false, horizontal: false }, alpha: 1.0 },
    common_keyframes: [], track_attribute: 0, track_render_index: 0,
    keyframe_refs: [], caption_info: null,
    hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
  }
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] })
  )
  const ep = args.ep
  if (!ep) {
    console.error('Usage: node scripts/make-capcut-draft.js --ep=<episode_number>')
    process.exit(1)
  }

  // 1. ep{N}_raw.mp4 확인
  const rawVideoPath = path.join(MEDIA_ROOT, 'downloads', 'output', `ep${ep}`, `ep${ep}_raw.mp4`)
  if (!fs.existsSync(rawVideoPath)) {
    console.error(`❌ ${rawVideoPath} 없음 — /api/concat-video를 먼저 실행하세요`)
    process.exit(1)
  }

  // 2. 총 길이 측정
  console.log('⏳ 영상 길이 측정 중...')
  const totalSec = await getMediaDuration(rawVideoPath)
  console.log(`   → ${totalSec.toFixed(2)}초`)

  // 3. ep{N}.srt 읽기
  const srtPath = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${ep}`, `ep${ep}.srt`)
  if (!fs.existsSync(srtPath)) {
    console.error(`❌ ${srtPath} 없음 — /api/generate-srt를 먼저 실행하세요`)
    process.exit(1)
  }
  const srtEntries = parseSRT(fs.readFileSync(srtPath, 'utf-8'))
  console.log(`✅ SRT: ${srtEntries.length}개 자막 항목`)

  // 4. yeori_edit_meta.json 읽기
  const metaPath = path.join(MEDIA_ROOT, 'downloads', 'video', 'yeori_edit_meta.json')
  const editMeta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    : []

  // 5. capcut_project_path.txt → draft_content.json 경로
  const projectPathFile = path.join(MEDIA_ROOT, 'capcut_project_path.txt')
  if (!fs.existsSync(projectPathFile)) {
    console.error(`❌ capcut_project_path.txt 없음`)
    console.error(`   CapCut 프로젝트 경로를 설정하세요:`)
    console.error(`   C:\\Users\\{user}\\AppData\\Local\\CapCut\\User Data\\Projects\\`)
    console.error(`   {프로젝트폴더}\\draft_content.json 경로를`)
    console.error(`   ${projectPathFile} 에 저장하세요`)
    process.exit(1)
  }
  let draftContentPath = fs.readFileSync(projectPathFile, 'utf-8').trim()
  if (fs.existsSync(draftContentPath) && fs.statSync(draftContentPath).isDirectory()) {
    draftContentPath = path.join(draftContentPath, 'draft_content.json')
  } else if (!draftContentPath.endsWith('draft_content.json')) {
    draftContentPath = path.join(draftContentPath, 'draft_content.json')
  }
  if (!fs.existsSync(path.dirname(draftContentPath))) {
    console.error(`❌ CapCut 프로젝트 폴더 없음: ${path.dirname(draftContentPath)}`)
    process.exit(1)
  }

  // 6. draft_content.json 구조 생성
  const draftId   = uid()
  const nowMs     = Date.now()
  const nowμs     = nowMs * 1000
  const totalDurμs = μs(totalSec)

  // 비디오 material + 보조 material
  const vMatId   = uid(); const vLocalId = uid()
  const speedVId = uid(); const canvasId = uid()
  const soundVId = uid(); const matColId = uid()
  const vocalId  = uid(); const phId     = uid()

  const videoMat = mkVideoMat(vMatId, vLocalId, rawVideoPath, totalSec, path.basename(rawVideoPath))

  const speeds    = [mkSpeed(speedVId)]
  const canvases  = [mkCanvas(canvasId)]
  const soundChs  = [mkSoundCh(soundVId)]
  const matColors = [mkMatColor(matColId)]
  const vocalSeps = [mkVocalSep(vocalId)]
  const phInfos   = [mkPhInfo(phId)]

  // 켄번스 팬업 키프레임 (전체 영상 수직 이동: -0.05 → 0.05)
  const kfContainerId = uid()
  const panKeyframes  = [
    {
      id: kfContainerId,
      keyframe_list: [
        { id: uid(), curveType: 'Line', graphType: 0, time_offset: 0,          values: [-0.05], dimension_infos: [] },
        { id: uid(), curveType: 'Line', graphType: 0, time_offset: totalDurμs, values: [0.05],  dimension_infos: [] },
      ],
      property_type: 'KFTypePositionY',
    },
  ]

  const videoSeg = mkVideoSeg(0, totalSec, vMatId, [speedVId, phId, canvasId, soundVId, matColId, vocalId], [kfContainerId])

  // 자막 materials + segments
  const textMats = []
  const textSegs = []
  for (const entry of srtEntries) {
    const tMatId = uid()
    const dur = Math.max(0.1, entry.endSec - entry.startSec)
    textMats.push(mkTextMat(tMatId, entry.text))
    textSegs.push(mkTextSeg(entry.startSec, dur, tMatId))
  }

  // draft_content.json
  const content = {
    id: draftId,
    version: 360000, new_version: '171.0.0',
    name: '', duration: totalDurμs,
    create_time: 0, update_time: 0,
    fps: 30.0, is_drop_frame_timecode: false, color_space: 0,
    config: {
      video_mute: false, record_audio_last_index: 1,
      extract_audio_last_index: 1, original_sound_last_index: 1,
      subtitle_recognition_id: '', subtitle_taskinfo: [],
      lyrics_recognition_id: '', lyrics_taskinfo: [],
      subtitle_sync: true, lyrics_sync: true, voice_change_sync: false,
      sticker_max_index: 1, adjust_max_index: 1, material_save_mode: 0,
      export_range: null, maintrack_adsorb: true, combination_max_index: 1,
      attachment_info: [], zoom_info_params: null, system_font_list: [],
      multi_language_mode: 'none', multi_language_main: 'none',
      multi_language_current: 'none', multi_language_list: [],
      subtitle_keywords_config: null, use_float_render: false,
    },
    canvas_config: { ratio: 'original', width: 1080, height: 1920, background: null },
    tracks: [
      { id: uid(), type: 'video', segments: [videoSeg],  flag: 0, attribute: 0, name: '', is_default_name: true },
      ...(textSegs.length ? [{ id: uid(), type: 'text', segments: textSegs, flag: 0, attribute: 0, name: '', is_default_name: true }] : []),
    ],
    group_container: null,
    materials: {
      flowers: [], videos: [videoMat], tail_leaders: [],
      audios: [], images: [], texts: textMats, effects: [], stickers: [],
      canvases, transitions: [], audio_effects: [], audio_fades: [], beats: [],
      material_animations: [], placeholders: [], placeholder_infos: phInfos,
      speeds, common_mask: [], chromas: [], text_templates: [],
      realtime_denoises: [], audio_pannings: [], audio_pitch_shifts: [],
      video_trackings: [], hsl: [], drafts: [],
      color_curves: [], hsl_curves: [], primary_color_wheels: [], log_color_wheels: [],
      video_effects: [], audio_balances: [], handwrites: [],
      manual_deformations: [], manual_beautys: [], plugin_effects: [],
      sound_channel_mappings: soundChs, green_screens: [], shapes: [], material_colors: matColors,
      digital_humans: [], digital_human_model_dressing: [],
      smart_crops: [], ai_translates: [], audio_track_indexes: [],
      loudnesses: [], vocal_beautifys: [], vocal_separations: vocalSeps,
      smart_relights: [], time_marks: [], multi_language_refs: [],
      video_shadows: [], video_strokes: [], video_radius: [],
    },
    keyframes: { videos: panKeyframes, audios: [], texts: [], stickers: [], filters: [], adjusts: [], handwrites: [], effects: [] },
    keyframe_graph_list: [],
    platform: { os: 'windows', os_version: '10.0.26200', app_id: 359289, app_version: '8.7.0', app_source: 'cc', device_id: 'f9f27968824f11a9c9c453da58e72e47', hard_disk_id: '', mac_address: 'e25ce3c797d1bd20fead2a5cb6a93bb1' },
    last_modified_platform: { os: 'windows', os_version: '10.0.26200', app_id: 359289, app_version: '8.7.0', app_source: 'cc', device_id: 'f9f27968824f11a9c9c453da58e72e47', hard_disk_id: '', mac_address: 'e25ce3c797d1bd20fead2a5cb6a93bb1' },
    mutable_config: null, cover: null, retouch_cover: null, extra_info: null,
    relationships: [], render_index_track_mode_on: true, free_render_index_mode_on: false,
    static_cover_image_path: '', source: 'default', time_marks: null, path: '',
    lyrics_effects: [],
    uneven_animation_template_info: { composition: '', content: '', order: '', sub_template_info_list: [] },
    draft_type: 'video',
    smart_ads_info: { page_from: '', routine: '', draft_url: '' },
    function_assistant_info: {
      smart_rec_applied: false, fixed_rec_applied: false, auto_adjust: false,
      auto_adjust_segid_list: [], color_correction: false, color_correction_segid_list: [],
      enhance_quality: false, smooth_slow_motion: false,
      deflicker_segid_list: [], video_noise_segid_list: [], enhance_quality_segid_list: [],
      smart_segid_list: [], retouch: false, retouch_segid_list: [],
      enhande_voice: false, enhance_voice_segid_list: [], audio_noise_segid_list: [],
      auto_caption: false, auto_caption_segid_list: [], auto_caption_template_id: '',
      caption_opt: false, caption_opt_segid_list: [], eye_correction: false,
      eye_correction_segid_list: [], normalize_loudness: false,
      normalize_loudness_segid_list: [], normalize_loudness_audio_denoise_segid_list: [],
      auto_adjust_fixed: false, auto_adjust_fixed_value: 50.0,
      color_correction_fixed: false, color_correction_fixed_value: 50.0,
      normalize_loudness_fixed: false, enhande_voice_fixed: false,
      retouch_fixed: false, enhance_quality_fixed: false, smooth_slow_motion_fixed: false,
      fps: { num: 0, den: 1 },
    },
  }

  // 7. draft_content.json 덮어쓰기
  fs.writeFileSync(draftContentPath, JSON.stringify(content), 'utf-8')

  console.log(`\n✅ draft_content.json 생성 완료!`)
  console.log(`   경로: ${draftContentPath}`)
  console.log(`   영상 길이: ${totalSec.toFixed(1)}초`)
  console.log(`   자막 수: ${srtEntries.length}개`)
  console.log(`\n   CapCut을 재시작하면 자동 반영됩니다.`)
}

main().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})

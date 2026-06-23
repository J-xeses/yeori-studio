#!/usr/bin/env node
// scripts/make-capcut-draft.js
// CapCut draft_content.json + draft_meta_info.json 자동 생성
// Usage: node scripts/make-capcut-draft.js <episode_number>
//
// 생성 구조:
//   VideoTrack:  cut_NN_final.mp4 우선, 없으면 cut_NN.mp4
//   AudioTrack:  audioFile 지정 → cut_NN_yeori_voice.mp3 → cut_NN.mp3 순으로 탐색
//   타임라인 배치: yeori_edit_meta.json 의 startSec / endSec 기반

import fs   from 'fs'
import path from 'path'

// ── 경로 ─────────────────────────────────────────────────
const MEDIA_ROOT  = 'C:\\yeori-studio'
const CAPCUT_ROOT = 'C:\\Users\\won56\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft'

// ── UUID 생성 ──────────────────────────────────────────────
function uid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16).toUpperCase()
  })
}

const μs = (sec) => Math.round(sec * 1_000_000)  // 초 → 마이크로초

// ── 보조 material 팩토리 ──────────────────────────────────
const mkSpeed    = (id) => ({ id, type: 'speed', mode: 0, speed: 1.0, curve_speed: null })
const mkCanvas   = (id) => ({ id, type: 'canvas_color', color: '', blur: 0.0, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' })
const mkSoundCh  = (id) => ({ id, type: 'none', audio_channel_mapping: 0, is_config_open: false })
const mkMatColor = (id) => ({ id, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90.0, width: 0.0, height: 0.0 })
const mkVocalSep = (id) => ({ id, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' })
const mkPhInfo   = (id) => ({ id, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' })

// ── 비디오 material ───────────────────────────────────────
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
      mouth_shape_driver: null,   // ← 립싱크 적용 시 채워질 필드
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

// ── 오디오 material ───────────────────────────────────────
function mkAudioMat(id, localId, filePath, durSec, name) {
  return {
    id, type: 'audio', name,
    path: filePath.replace(/\\/g, '/'),
    duration: μs(durSec),
    source_platform: 0, team_id: '',
    local_material_id: localId,
    music_id: '', category_id: '', category_name: 'local',
    loudness: 0.0, format: '', bit_rate: 0, sample_rate: 0, channels: 0,
    audio_fade: null,
  }
}

// ── 비디오 세그먼트 ───────────────────────────────────────
function mkVideoSeg(startSec, durSec, matId, refs) {
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
    extra_material_refs: refs,
    render_index: 0, keyframe_refs: [],
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

// ── 오디오 세그먼트 ───────────────────────────────────────
function mkAudioSeg(startSec, durSec, matId, refs) {
  return {
    id: uid(),
    source_timerange: { start: 0,            duration: μs(durSec) },
    target_timerange: { start: μs(startSec), duration: μs(durSec) },
    material_id: matId,
    extra_material_refs: refs,
    render_index: 0,
    volume: 1.0, speed: 1.0, is_loop: false, reverse: false,
    hdr_settings: { mode: 1, intensity: 1.0, nits: 1000 },
    uniform_scale: { on: true, value: 1.0 },
    common_keyframes: [], track_attribute: 0, track_render_index: 0,
    visible: true, clip: null, keyframe_refs: [],
  }
}

// ── 메인 ─────────────────────────────────────────────────
const ep = process.argv[2]
if (!ep) {
  console.error('Usage: node scripts/make-capcut-draft.js <episode_number>')
  process.exit(1)
}

// yeori_edit_meta.json 읽기
const metaPath = path.join(MEDIA_ROOT, 'downloads', 'video', 'yeori_edit_meta.json')
if (!fs.existsSync(metaPath)) {
  console.error(`❌ yeori_edit_meta.json 없음: ${metaPath}`); process.exit(1)
}
const editMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
const cuts = Array.isArray(editMeta) ? editMeta : []

const videoDir = path.join(MEDIA_ROOT, 'downloads', 'video', `ep${ep}`)
const audioDir = path.join(MEDIA_ROOT, 'downloads', 'audio', `ep${ep}`)

// 파일 존재 확인 후 유효 컷만 필터 (cut_NN_final.mp4 우선, 없으면 cut_NN.mp4)
const validCuts = cuts.filter(cut => {
  const p     = String(cut.cutNo).padStart(2, '0')
  const vFin  = path.join(videoDir, `cut_${p}_final.mp4`)
  const vBase = path.join(videoDir, `cut_${p}.mp4`)
  const vOk   = fs.existsSync(vFin) || fs.existsSync(vBase)
  if (!vOk) console.warn(`⚠️  CUT ${cut.cutNo}: 영상 없음`)
  return vOk
})

if (!validCuts.length) {
  console.error('❌ 유효한 컷이 없습니다.'); process.exit(1)
}

// ── 컷별 material + 보조 material 생성 ───────────────────
const videoMats  = []
const audioMats  = []
const speeds     = []
const canvases   = []
const soundChs   = []
const matColors  = []
const vocalSeps  = []
const phInfos    = []

const cutData = validCuts.map(cut => {
  const p        = String(cut.cutNo).padStart(2, '0')
  const dur      = cut.duration || 8
  const vMatId   = uid(); const vLocalId = uid()
  const aMatId   = uid(); const aLocalId = uid()
  const speedVId = uid(); const speedAId = uid()
  const canvasId = uid()
  const soundVId = uid(); const soundAId = uid()
  const matColId = uid()
  const vocalId  = uid()
  const phId     = uid()

  // 영상 파일: cut_NN_final.mp4 우선, 없으면 cut_NN.mp4
  const finalVid  = path.join(videoDir, `cut_${p}_final.mp4`)
  const baseVid   = path.join(videoDir, `cut_${p}.mp4`)
  const videoFile = fs.existsSync(finalVid) ? finalVid : baseVid
  const videoName = path.basename(videoFile)

  // 오디오 파일: audioFile 지정 → cut_NN_yeori_voice.mp3 → cut_NN.mp3
  let audioFile, audioName
  if (cut.audioFile) {
    audioFile = path.isAbsolute(cut.audioFile) ? cut.audioFile : path.join(audioDir, cut.audioFile)
    audioName = path.basename(audioFile)
  } else {
    const yeoriAudio = path.join(audioDir, `cut_${p}_yeori_voice.mp3`)
    const baseAudio  = path.join(audioDir, `cut_${p}.mp3`)
    audioFile = fs.existsSync(yeoriAudio) ? yeoriAudio : baseAudio
    audioName = path.basename(audioFile)
  }

  videoMats.push(mkVideoMat(vMatId, vLocalId, videoFile, dur, videoName))
  audioMats.push(mkAudioMat(aMatId, aLocalId, audioFile, dur, audioName))

  speeds.push(mkSpeed(speedVId))
  speeds.push(mkSpeed(speedAId))
  canvases.push(mkCanvas(canvasId))
  soundChs.push(mkSoundCh(soundVId))
  soundChs.push(mkSoundCh(soundAId))
  matColors.push(mkMatColor(matColId))
  vocalSeps.push(mkVocalSep(vocalId))
  phInfos.push(mkPhInfo(phId))

  return {
    cut, dur,
    videoFile, videoName, audioFile, audioName,
    vMatId, aMatId, vLocalId, aLocalId,
    speedVId, speedAId, canvasId,
    soundVId, soundAId,
    matColId, vocalId, phId,
  }
})

// ── 타임라인 세그먼트 배치 (startSec은 yeori_edit_meta.json 값 사용) ──
const videoSegs = []
const audioSegs = []

for (const d of cutData) {
  const startSec   = d.cut.startSec ?? 0
  const audioDelay = parseFloat(d.cut.audioStart) || 0
  const audioEnd   = parseFloat(d.cut.audioEnd) || d.dur
  const audioDur   = Math.max(0.01, audioEnd - audioDelay)
  // video extra_refs: [speed, placeholder_info, canvas, sound_channel, material_color, vocal_separation]
  videoSegs.push(mkVideoSeg(startSec, d.dur, d.vMatId, [d.speedVId, d.phId, d.canvasId, d.soundVId, d.matColId, d.vocalId]))
  // audio extra_refs: [speed, sound_channel]
  audioSegs.push(mkAudioSeg(startSec + audioDelay, audioDur, d.aMatId, [d.speedAId, d.soundAId]))
}

const totalSec   = validCuts.length ? Math.max(...validCuts.map(c => c.endSec ?? ((c.startSec ?? 0) + (c.duration ?? 8)))) : 0
const totalDurμs = μs(totalSec)
const draftId    = uid()
const draftName  = `yeori_ep${ep}_${new Date().toISOString().slice(0, 10)}`
const draftDir   = path.join(CAPCUT_ROOT, draftName)

// ── draft_content.json ────────────────────────────────────
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
    { id: uid(), type: 'video', segments: videoSegs, flag: 0, attribute: 0, name: '', is_default_name: true },
    { id: uid(), type: 'audio', segments: audioSegs, flag: 0, attribute: 0, name: '', is_default_name: true },
  ],
  group_container: null,
  materials: {
    flowers: [], videos: videoMats, tail_leaders: [],
    audios: audioMats, images: [], texts: [], effects: [], stickers: [],
    canvases,
    transitions: [], audio_effects: [], audio_fades: [], beats: [],
    material_animations: [], placeholders: [], placeholder_infos: phInfos,
    speeds, common_mask: [], chromas: [], text_templates: [],
    realtime_denoises: [], audio_pannings: [], audio_pitch_shifts: [],
    video_trackings: [], hsl: [], drafts: [],
    color_curves: [], hsl_curves: [], primary_color_wheels: [], log_color_wheels: [],
    video_effects: [], audio_balances: [], handwrites: [],
    manual_deformations: [], manual_beautys: [], plugin_effects: [],
    sound_channel_mappings: soundChs,
    green_screens: [], shapes: [], material_colors: matColors,
    digital_humans: [], digital_human_model_dressing: [],
    smart_crops: [], ai_translates: [], audio_track_indexes: [],
    loudnesses: [], vocal_beautifys: [], vocal_separations: vocalSeps,
    smart_relights: [], time_marks: [], multi_language_refs: [],
    video_shadows: [], video_strokes: [], video_radius: [],
  },
  keyframes: { videos: [], audios: [], texts: [], stickers: [], filters: [], adjusts: [], handwrites: [], effects: [] },
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

// ── draft_meta_info.json ──────────────────────────────────
const nowMs = Date.now()
const nowμs = nowMs * 1000

const meta = {
  cloud_draft_cover: false, cloud_draft_sync: false,
  cloud_package_completed_time: '',
  draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false,
  draft_cloud_package_type: '', draft_cloud_purchase_info: '',
  draft_cloud_template_id: '', draft_cloud_tutorial_info: '',
  draft_cloud_videocut_purchase_info: '',
  draft_cover: 'draft_cover.jpg', draft_deeplink_url: '',
  draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
  draft_fold_path: draftDir.replace(/\\/g, '/'),
  draft_id: draftId,
  draft_is_ae_produce: false, draft_is_ai_packaging_used: false,
  draft_is_ai_shorts: false, draft_is_ai_translate: false,
  draft_is_article_video_draft: false, draft_is_cloud_temp_draft: false,
  draft_is_from_deeplink: 'false', draft_is_invisible: false,
  draft_is_pippit_draft: false, draft_is_web_article_video: false,
  draft_materials: [
    {
      type: 0,
      value: cutData.map(d => ({
        ai_group_type: '', create_time: Math.floor(nowMs / 1000),
        duration: μs(d.dur), enter_from: 0,
        extra_info: d.videoName,
        file_Path: d.videoFile.replace(/\\/g, '/'),
        height: 1280, id: d.vLocalId,
        import_time: Math.floor(nowMs / 1000),
        import_time_ms: nowμs,
        item_source: 1, md5: '', metetype: 'video',
        roughcut_time_range: { duration: μs(d.dur), start: 0 },
        sub_time_range: { duration: -1, start: -1 },
        type: 0, width: 720,
      })),
    },
    { type: 1, value: [] },
    {
      type: 2,
      value: cutData.map(d => ({
        ai_group_type: '', create_time: Math.floor(nowMs / 1000),
        duration: μs(d.dur), enter_from: 0,
        extra_info: d.audioName,
        file_Path: d.audioFile.replace(/\\/g, '/'),
        height: 0, id: d.aLocalId,
        import_time: Math.floor(nowMs / 1000),
        import_time_ms: nowμs,
        item_source: 1, md5: '', metetype: 'audio',
        roughcut_time_range: { duration: μs(d.dur), start: 0 },
        sub_time_range: { duration: -1, start: -1 },
        type: 2, width: 0,
      })),
    },
    { type: 3, value: [] },
    { type: 6, value: [] },
    { type: 7, value: [] },
    { type: 8, value: [] },
  ],
  draft_materials_copied_info: [],
  draft_name: draftName,
  draft_need_rename_folder: false, draft_new_version: '',
  draft_removable_storage_device: '',
  draft_root_path: CAPCUT_ROOT.replace(/\\/g, '/'),
  draft_segment_extra_info: [],
  draft_timeline_materials_size_: 0,
  draft_type: '', draft_web_article_video_enter_from: '',
  tm_draft_cloud_completed: '', tm_draft_cloud_entry_id: -1,
  tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1,
  tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1,
  tm_draft_create: nowμs,
  tm_draft_modified: nowμs,
  tm_draft_removed: 0,
  tm_duration: totalDurμs,
}

// ── 파일 출력 ─────────────────────────────────────────────
fs.mkdirSync(draftDir, { recursive: true })
;['matting', 'smart_crop', 'subdraft', 'Timelines', 'adjust_mask', 'common_attachment', 'qr_upload'].forEach(d =>
  fs.mkdirSync(path.join(draftDir, d), { recursive: true })
)

fs.writeFileSync(path.join(draftDir, 'draft_content.json'),   JSON.stringify(content), 'utf-8')
fs.writeFileSync(path.join(draftDir, 'draft_meta_info.json'), JSON.stringify(meta),    'utf-8')
fs.writeFileSync(path.join(draftDir, 'draft_biz_config.json'), '',                     'utf-8')

console.log(`\n✅ CapCut 드래프트 생성 완료!`)
console.log(`   폴더: ${draftDir}`)
console.log(`   컷 수: ${validCuts.length}개 / 총 길이: ${totalSec}초`)
console.log(`\n   → CapCut 실행 후 [드래프트] 목록에 "${draftName}"으로 나타납니다.`)
console.log(`     (CapCut이 이미 열려 있으면 재시작 후 확인)`)

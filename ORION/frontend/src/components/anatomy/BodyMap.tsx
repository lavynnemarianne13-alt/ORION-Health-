import { useId } from 'react';
import SegmentedControl from '../ui/SegmentedControl';

export type BodyView = 'front' | 'back';

export type RegionId =
  | 'head' | 'neck' | 'right_shoulder' | 'left_shoulder'
  | 'right_upper_arm' | 'left_upper_arm' | 'right_forearm' | 'left_forearm' | 'chest' | 'abdomen'
  | 'upper_back' | 'lower_back' | 'pelvis'
  | 'right_thigh' | 'left_thigh' | 'right_knee' | 'left_knee'
  | 'right_calf' | 'left_calf';

export type BodyRegion = {
  id: RegionId;
  name: string;
  label: string;
  category: 'muscular' | 'articular' | 'general';
  side: 'right' | 'left' | 'midline';
};

// eslint-disable-next-line react-refresh/only-export-components
export const regions: BodyRegion[] = [
  { id: 'head', name: 'Head', label: 'Head', category: 'general', side: 'midline' },
  { id: 'neck', name: 'Neck', label: 'Neck', category: 'general', side: 'midline' },
  { id: 'right_shoulder', name: 'Right shoulder', label: 'Right shoulder', category: 'articular', side: 'right' },
  { id: 'left_shoulder', name: 'Left shoulder', label: 'Left shoulder', category: 'articular', side: 'left' },
  { id: 'right_upper_arm', name: 'Right upper arm', label: 'Right upper arm', category: 'muscular', side: 'right' },
  { id: 'left_upper_arm', name: 'Left upper arm', label: 'Left upper arm', category: 'muscular', side: 'left' },
  { id: 'right_forearm', name: 'Right forearm', label: 'Right forearm', category: 'muscular', side: 'right' },
  { id: 'left_forearm', name: 'Left forearm', label: 'Left forearm', category: 'muscular', side: 'left' },
  { id: 'chest', name: 'Chest', label: 'Chest', category: 'muscular', side: 'midline' },
  { id: 'abdomen', name: 'Abdomen', label: 'Abdomen', category: 'muscular', side: 'midline' },
  { id: 'upper_back', name: 'Upper back', label: 'Upper back', category: 'muscular', side: 'midline' },
  { id: 'lower_back', name: 'Lower back', label: 'Lower back', category: 'muscular', side: 'midline' },
  { id: 'pelvis', name: 'Hip & pelvis', label: 'Pelvis', category: 'articular', side: 'midline' },
  { id: 'right_thigh', name: 'Right thigh', label: 'Right thigh', category: 'muscular', side: 'right' },
  { id: 'left_thigh', name: 'Left thigh', label: 'Left thigh', category: 'muscular', side: 'left' },
  { id: 'right_knee', name: 'Right knee', label: 'Right knee', category: 'articular', side: 'right' },
  { id: 'left_knee', name: 'Left knee', label: 'Left knee', category: 'articular', side: 'left' },
  { id: 'right_calf', name: 'Right calf', label: 'Right calf', category: 'muscular', side: 'right' },
  { id: 'left_calf', name: 'Left calf', label: 'Left calf', category: 'muscular', side: 'left' }
];

// eslint-disable-next-line react-refresh/only-export-components
export const findRegion = (id: RegionId): BodyRegion => regions.find(region => region.id === id)!;

type Muscle = {
  d: string;
  back?: string;
  view?: BodyView;
  region?: RegionId;
  side?: 'shoulder' | 'upper_arm' | 'forearm' | 'thigh' | 'knee' | 'calf';
  tone: string;
};

const muscles: Muscle[] = [
  { d: 'M141 61L127 68L105 88L132 84L150 100L150 69Z', region: 'neck', tone: 'neutral' },
  { d: 'M136 62Q132 80 148 95L145 72Z', region: 'neck', tone: 'light' },
  { d: 'M105 88C88 86 73 95 68 115Q65 124 69 135Q82 126 95 112L113 93Z', side: 'shoulder', tone: 'lime' },
  { d: 'M69 135Q79 130 88 116L98 110L93 130Q84 141 74 148Z', side: 'shoulder', tone: 'olive' },
  { d: 'M113 93Q136 85 149 100L148 130Q137 148 113 142L94 129Z', view: 'front', region: 'chest', tone: 'lime' },
  { d: 'M104 137L118 145L121 162L110 154Z', view: 'front', region: 'abdomen', tone: 'light' },
  { d: 'M112 155L123 164L121 184L108 171Z', view: 'front', region: 'abdomen', tone: 'neutral' },
  { d: 'M109 173L121 187L118 204L103 194Z', view: 'front', region: 'abdomen', tone: 'light' },
  { d: 'M122 148Q133 141 147 147L148 166Q134 169 122 163Z', view: 'front', region: 'abdomen', tone: 'olive' },
  { d: 'M123 166Q136 170 148 167L148 184Q136 188 123 181Z', view: 'front', region: 'abdomen', tone: 'lime' },
  { d: 'M123 185Q135 190 148 185L148 202Q135 206 125 200Z', view: 'front', region: 'abdomen', tone: 'olive' },
  { d: 'M126 204Q137 207 148 204L148 240Q137 235 128 220Z', view: 'front', region: 'abdomen', tone: 'lime' },
  { d: 'M103 196Q114 209 126 209L140 246L116 254L101 227Z', view: 'front', region: 'pelvis', tone: 'neutral' },
  { d: 'M113 93L149 98L148 144L125 126L96 125Z', view: 'back', region: 'upper_back', tone: 'light' },
  { d: 'M98 129Q123 130 148 149L147 189Q126 182 112 159Z', view: 'back', region: 'upper_back', tone: 'olive' },
  { d: 'M112 160Q128 177 148 190L148 222L121 204Z', view: 'back', region: 'lower_back', tone: 'lime' },
  { d: 'M120 208L148 224L148 247L122 238Z', view: 'back', region: 'lower_back', tone: 'light' },
  { d: 'M105 226Q128 218 147 246L145 268Q127 281 104 260Z', view: 'back', region: 'pelvis', tone: 'neutral' },
  { d: 'M79 142Q91 129 97 138Q98 159 87 184L75 192Q68 171 79 142Z', back: 'M76 141Q88 129 96 139Q100 159 85 188L73 193Q65 170 76 141Z', side: 'upper_arm', tone: 'olive' },
  { d: 'M69 138L78 141Q69 164 73 190L64 200Q58 175 69 138Z', side: 'upper_arm', tone: 'neutral' },
  { d: 'M66 190L75 192L68 203L60 204Z', tone: 'light' },
  { d: 'M60 205Q74 198 79 190Q79 222 59 252L50 247Q52 225 60 205Z', side: 'forearm', tone: 'lime' },
  { d: 'M52 202Q57 195 63 205Q55 229 50 247L43 252Q43 226 52 202Z', side: 'forearm', tone: 'neutral' },
  { d: 'M46 248L59 252L54 266L45 269L39 262Z', tone: 'light' },
  { d: 'M39 264L49 269L46 283L37 292L32 288L27 302L23 301L28 283L19 293L16 290L26 275L20 279L17 276Z', tone: 'neutral' },
  { d: 'M44 271L40 291M37 273L30 289M33 271L24 284', tone: 'line' },
  { d: 'M104 247Q108 266 126 260L121 300Q117 329 123 351L110 344Q94 317 96 285Z', view: 'front', side: 'thigh', tone: 'lime' },
  { d: 'M128 260L145 249L146 287L135 312L128 339Q119 314 124 291Z', view: 'front', side: 'thigh', tone: 'neutral' },
  { d: 'M101 263Q108 289 116 315L126 347L118 352Q105 335 99 313Z', view: 'front', side: 'thigh', tone: 'olive' },
  { d: 'M141 277L145 302L138 329L133 348L126 351Q130 327 132 307Z', view: 'front', side: 'thigh', tone: 'olive' },
  { d: 'M101 263Q117 278 129 269L122 301Q113 330 116 349L107 341Q97 310 101 263Z', view: 'back', side: 'thigh', tone: 'olive' },
  { d: 'M129 270L145 257L145 294Q143 321 131 350L122 349Q124 312 129 270Z', view: 'back', side: 'thigh', tone: 'lime' },
  { d: 'M111 344Q124 357 132 345L139 355L134 371L118 373L108 359Z', side: 'knee', tone: 'neutral' },
  { d: 'M109 367L121 375Q124 405 120 436L113 452Q101 426 101 402Q100 382 109 367Z', back: 'M109 367Q116 372 123 375L122 417Q111 435 111 450Q99 425 101 398Q101 379 109 367Z', side: 'calf', tone: 'olive' },
  { d: 'M123 375L135 370Q142 397 136 420L124 454L118 454Q125 411 123 375Z', back: 'M124 375L135 367Q144 384 140 406Q137 428 124 449L118 453Q127 414 124 375Z', side: 'calf', tone: 'neutral' },
  { d: 'M113 447L124 453L124 470L113 476L108 466Z', tone: 'light' },
  { d: 'M108 466L113 477L124 470L128 482L122 489L103 488L101 482Z', tone: 'neutral' },
];

const outline = 'M150 12C130 12 120 25 121 42L123 53Q118 49 120 59L126 66L136 72L132 79L105 86Q77 84 67 111L62 145L55 182L46 203L38 249L31 261L16 276L15 293L23 303L33 305L48 290L58 268L83 204L96 148L105 194L99 228L94 286L100 326L108 354L100 391L103 428L111 461L99 480L102 490L126 491L130 481L129 465L138 424L145 373L146 310L150 271L154 310L155 373L162 424L171 465L170 481L174 491L198 490L201 480L189 461L197 428L200 391L192 354L200 326L206 286L201 228L195 194L204 148L217 204L242 268L252 290L267 305L277 303L285 293L284 276L269 261L262 249L254 203L245 182L238 145L233 111Q223 84 195 86L168 79L164 72L174 66L180 59Q182 49 177 53L179 42C180 25 170 12 150 12Z';
const head = 'M150 15C131 15 125 28 126 44L128 60Q132 70 150 72Q168 70 172 60L174 44C175 28 169 15 150 15Z';

interface BodyMapProps {
  selected: RegionId;
  onSelect: (id: RegionId) => void;
  view: BodyView;
  onViewChange: (view: BodyView) => void;
}

export default function BodyMap({ selected, onSelect, view, onViewChange }: BodyMapProps) {
  const id = useId();
  const front = view === 'front';
  const left = front ? 'right' : 'left';
  const right = front ? 'left' : 'right';
  const focusable = new Set<RegionId>();
  function drawPart(d: string, tone: string, key: string | number, region?: RegionId) {
    if (!region) return <path key={key} d={d} className={`atlas-fiber ${tone}`}/>;
    const first = !focusable.has(region);
    focusable.add(region);
    return <path key={key} d={d} className={`atlas-fiber atlas-region ${tone} ${selected === region ? 'is-selected' : ''}`}
      role={first ? 'button' : undefined} tabIndex={first ? 0 : undefined}
      aria-label={first ? `Select ${findRegion(region).name}` : undefined} aria-pressed={first ? selected === region : undefined}
      onClick={() => onSelect(region)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(region);
        }
      }}/>;
  }
  function half(side: 'left' | 'right') {
    return muscles.map((muscle, index) => {
      if (muscle.view && muscle.view !== view) return null;
      const region = muscle.side ? `${side}_${muscle.side}` as RegionId : muscle.region;
      return drawPart(!front && muscle.back ? muscle.back : muscle.d, muscle.tone, index, region);
    });
  }
  return <div className="body-atlas">
    <div className="surface-heading"><span className="caps">Crew anatomical map</span>
      <SegmentedControl label="Anatomical view" options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} value={view} onChange={onViewChange}/>
    </div>
    <svg className="atlas-svg" viewBox="0 0 300 510" role="group" aria-label={`Interactive ${view} muscular anatomy`}>
      <defs>
        <pattern id={`${id}-grid`} width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0V18" stroke="#85858d" opacity=".13" fill="none" strokeWidth=".5"/></pattern>
      </defs>
      <rect x="1" y="1" width="298" height="508" rx="9" fill={`url(#${id}-grid)`}/>
      <ellipse cx="150" cy="255" rx="140" ry="239" fill="none" stroke="#737c55" opacity=".23"/>
      <path className="atlas-axis" d="M150 3V502M8 254H292"/>
      <text x="12" y="19">{left[0].toUpperCase()}</text><text x="280" y="19">{right[0].toUpperCase()}</text>
      <path className="atlas-outline" d={outline}/>
      {half(left)}<g transform="translate(300 0) scale(-1 1)">{half(right)}</g>
      {drawPart(head, 'light', 'head', 'head')}
      {!front && <path className="atlas-fiber line" d="M150 77L150 231"/>}
      <text x="150" y="506" textAnchor="middle" className="atlas-scale">ILLUSTRATIVE ANATOMY / NOT TO SCALE</text>
    </svg>
    <p className="atlas-footnote">{front ? 'Anterior' : 'Posterior'} view · Left and right refer to the crew member’s anatomical sides.</p>
  </div>;
}

import type { KeyboardEvent } from 'react';

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

// Front and back views share the same anatomical region identifiers.
// Anatomical right appears on the viewer’s left in the frontal view.
const frontParts: { region: RegionId; d: string }[] = [
  { region: 'head', d: 'M180 24 C157 24 145 45 148 74 C149 96 163 114 180 116 C197 114 211 96 212 74 C215 45 203 24 180 24 Z' },
  { region: 'neck', d: 'M163 108 L197 108 L201 142 Q180 154 159 142 Z' },
  { region: 'right_shoulder', d: 'M156 142 C135 135 114 142 102 159 C96 169 95 187 103 203 L128 207 L146 177 Z' },
  { region: 'left_shoulder', d: 'M204 142 C225 135 246 142 258 159 C264 169 265 187 257 203 L232 207 L214 177 Z' },
  { region: 'right_upper_arm', d: 'M103 202 L128 208 C125 238 116 269 108 290 L77 289 C80 251 87 220 103 202 Z' },
  { region: 'left_upper_arm', d: 'M257 202 L232 208 C235 238 244 269 252 290 L283 289 C280 251 273 220 257 202 Z' },
  { region: 'right_forearm', d: 'M77 289 L108 290 L97 358 C91 373 81 374 73 364 C69 359 72 347 73 337 Z' },
  { region: 'left_forearm', d: 'M283 289 L252 290 L263 358 C269 373 279 374 287 364 C291 359 288 347 287 337 Z' },
  { region: 'chest', d: 'M156 143 Q180 150 204 143 L215 176 L232 210 L227 243 Q180 260 133 243 L128 210 L145 176 Z' },
  { region: 'abdomen', d: 'M134 244 Q180 263 226 244 C222 272 227 292 224 318 Q180 337 136 318 C133 291 138 271 134 244 Z' },
  { region: 'pelvis', d: 'M136 320 Q180 339 224 320 L235 371 Q210 389 185 397 L175 397 Q150 389 125 371 Z' },
  { region: 'right_thigh', d: 'M126 373 Q151 387 175 397 L173 476 Q169 500 158 508 L127 507 Q118 487 120 467 L118 409 Z' },
  { region: 'left_thigh', d: 'M234 373 Q209 387 185 397 L187 476 Q191 500 202 508 L233 507 Q242 487 240 467 L242 409 Z' },
  { region: 'right_knee', d: 'M127 508 Q143 517 158 509 L160 538 Q144 551 126 539 Z' },
  { region: 'left_knee', d: 'M233 508 Q217 517 202 509 L200 538 Q216 551 234 539 Z' },
  { region: 'right_calf', d: 'M126 541 Q143 554 160 540 L155 585 L149 612 L122 612 L119 583 Z' },
  { region: 'left_calf', d: 'M234 541 Q217 554 200 540 L205 585 L211 612 L238 612 L241 583 Z' }
];
const backParts: { region: RegionId; d: string }[] = [
  ...frontParts.filter(part => ['head', 'neck', 'right_shoulder', 'left_shoulder', 'right_upper_arm', 'left_upper_arm', 'right_forearm', 'left_forearm', 'right_thigh', 'left_thigh', 'right_knee', 'left_knee', 'right_calf', 'left_calf'].includes(part.region)),
  { region: 'upper_back', d: 'M156 143 Q180 150 204 143 L215 176 L232 210 L227 256 Q180 270 133 256 L128 210 L145 176 Z' },
  { region: 'lower_back', d: 'M133 257 Q180 274 227 257 L224 318 Q180 337 136 318 Z' },
  { region: 'pelvis', d: 'M136 320 Q180 339 224 320 L235 371 Q210 389 185 397 L175 397 Q150 389 125 371 Z' }
];

interface BodyMapProps {
  selected: RegionId;
  onSelect: (id: RegionId) => void;
  view: BodyView;
  onViewChange: (view: BodyView) => void;
  compact?: boolean;
}

export default function BodyMap({ selected, onSelect, view, onViewChange, compact = false }: BodyMapProps) {
  const parts = view === 'front' ? frontParts : backParts;
  const selectWithKeyboard = (event: KeyboardEvent<SVGPathElement>, region: RegionId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(region);
    }
  };
  return (
    <div className={`body-atlas ${compact ? 'body-atlas--compact' : ''}`}>
      <div className="atlas-toolbar">
        <div className="atlas-tag"><span className="atlas-tag-dot"/> ANATOMICAL ATLAS</div>
        <div className="atlas-view-switch" role="group" aria-label="Anatomical view">
          <button type="button" aria-pressed={view === 'front'} className={view === 'front' ? 'is-active' : ''} onClick={() => onViewChange('front')}>Front</button>
          <button type="button" aria-pressed={view === 'back'} className={view === 'back' ? 'is-active' : ''} onClick={() => onViewChange('back')}>Back</button>
        </div>
      </div>
      <div className="atlas-canvas">
        <span className="atlas-annotation atlas-annotation--top">HUMAN BODY · {view === 'front' ? 'ANTERIOR' : 'POSTERIOR'}</span>
        <svg className="atlas-svg" viewBox="0 0 360 645" role="group" aria-label={`Human body, ${view === 'front' ? 'front view' : 'back view'}, with selectable regions`}>
          <defs>
            <pattern id="atlasGrid" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.65" fill="#b3b7bc" opacity=".33" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="360" height="645" fill="url(#atlasGrid)" />
          <ellipse cx="180" cy="296" rx="144" ry="216" fill="none" stroke="#d4d8dc" strokeWidth="1" strokeDasharray="3 9" />
          <path d="M180 10 V625 M20 318 H340" stroke="#dbdee2" strokeWidth="1" strokeDasharray="2 12" pointerEvents="none" />
          {parts.map(part => {
            const label = findRegion(part.region).name;
            return (
              <path
                key={`${view}-${part.region}`}
                d={part.d}
                role="button"
                tabIndex={0}
                aria-label={`Select ${label}`}
                aria-pressed={selected === part.region}
                className={`atlas-region ${selected === part.region ? 'is-selected' : ''}`}
                onClick={() => onSelect(part.region)}
                onKeyDown={event => selectWithKeyboard(event, part.region)}
              >
                <title>{label}</title>
              </path>
            );
          })}
          <path className="atlas-anatomical-line" d="M180 154 V245 M159 186 Q180 198 201 186 M155 276 Q180 284 205 276 M180 338 V388" pointerEvents="none" />
          {view === 'back' && <path className="atlas-anatomical-line" d="M180 160 V328 M147 225 Q180 242 213 225" pointerEvents="none" />}
          <path className="atlas-foot" d="M122 611 L149 611 L152 629 Q137 637 111 632 Z M211 611 L238 611 L249 632 Q223 637 208 629 Z" pointerEvents="none" />
        </svg>
        <div className="atlas-edge-label atlas-edge-label--left">RIGHT</div>
        <div className="atlas-edge-label atlas-edge-label--right">LEFT</div>
        <span className="atlas-annotation atlas-annotation--bottom">SELECT A BODY REGION</span>
      </div>
      {!compact && <p className="atlas-footnote">Right and left refer to the subject’s anatomical sides. This atlas is for navigation, not diagnosis.</p>}
    </div>
  );
}

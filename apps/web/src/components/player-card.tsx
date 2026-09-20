'use client';

import type { PublicLot } from '@gavel-xi/shared';
import { memo, useEffect, useState } from 'react';
import { formatMoney, initials } from '@/lib/format';

function ImageFallback({ name }: { name: string }) {
  return (
    <div className="card-silhouette" aria-hidden="true">
      <span className="card-silhouette__head" />
      <span className="card-silhouette__body" />
      <b>{initials(name)}</b>
    </div>
  );
}

const ISO_ALPHA3 = Object.fromEntries(
  'ABW:AW,AFG:AF,AGO:AO,AIA:AI,ALA:AX,ALB:AL,AND:AD,ARE:AE,ARG:AR,ARM:AM,ASM:AS,ATA:AQ,ATF:TF,ATG:AG,AUS:AU,AUT:AT,AZE:AZ,BDI:BI,BEL:BE,BEN:BJ,BES:BQ,BFA:BF,BGD:BD,BGR:BG,BHR:BH,BHS:BS,BIH:BA,BLM:BL,BLR:BY,BLZ:BZ,BMU:BM,BOL:BO,BRA:BR,BRB:BB,BRN:BN,BTN:BT,BVT:BV,BWA:BW,CAF:CF,CAN:CA,CCK:CC,CHE:CH,CHL:CL,CHN:CN,CIV:CI,CMR:CM,COD:CD,COG:CG,COK:CK,COL:CO,COM:KM,CPV:CV,CRI:CR,CUB:CU,CUW:CW,CXR:CX,CYM:KY,CYP:CY,CZE:CZ,DEU:DE,DJI:DJ,DMA:DM,DNK:DK,DOM:DO,DZA:DZ,ECU:EC,EGY:EG,ERI:ER,ESH:EH,ESP:ES,EST:EE,ETH:ET,FIN:FI,FJI:FJ,FLK:FK,FRA:FR,FRO:FO,FSM:FM,GAB:GA,GBR:GB,GEO:GE,GGY:GG,GHA:GH,GIB:GI,GIN:GN,GLP:GP,GMB:GM,GNB:GW,GNQ:GQ,GRC:GR,GRD:GD,GRL:GL,GTM:GT,GUF:GF,GUM:GU,GUY:GY,HKG:HK,HMD:HM,HND:HN,HRV:HR,HTI:HT,HUN:HU,IDN:ID,IMN:IM,IND:IN,IOT:IO,IRL:IE,IRN:IR,IRQ:IQ,ISL:IS,ISR:IL,ITA:IT,JAM:JM,JEY:JE,JOR:JO,JPN:JP,KAZ:KZ,KEN:KE,KGZ:KG,KHM:KH,KIR:KI,KNA:KN,KOR:KR,KWT:KW,LAO:LA,LBN:LB,LBR:LR,LBY:LY,LCA:LC,LIE:LI,LKA:LK,LSO:LS,LTU:LT,LUX:LU,LVA:LV,MAC:MO,MAF:MF,MAR:MA,MCO:MC,MDA:MD,MDG:MG,MDV:MV,MEX:MX,MHL:MH,MKD:MK,MLI:ML,MLT:MT,MMR:MM,MNE:ME,MNG:MN,MNP:MP,MOZ:MZ,MRT:MR,MSR:MS,MTQ:MQ,MUS:MU,MWI:MW,MYS:MY,MYT:YT,NAM:NA,NCL:NC,NER:NE,NFK:NF,NGA:NG,NIC:NI,NIU:NU,NLD:NL,NOR:NO,NPL:NP,NRU:NR,NZL:NZ,OMN:OM,PAK:PK,PAN:PA,PCN:PN,PER:PE,PHL:PH,PLW:PW,PNG:PG,POL:PL,PRI:PR,PRK:KP,PRT:PT,PRY:PY,PSE:PS,PYF:PF,QAT:QA,REU:RE,ROU:RO,RUS:RU,RWA:RW,SAU:SA,SDN:SD,SEN:SN,SGP:SG,SGS:GS,SHN:SH,SJM:SJ,SLB:SB,SLE:SL,SLV:SV,SMR:SM,SOM:SO,SPM:PM,SRB:RS,SSD:SS,STP:ST,SUR:SR,SVK:SK,SVN:SI,SWE:SE,SWZ:SZ,SXM:SX,SYC:SC,SYR:SY,TCA:TC,TCD:TD,TGO:TG,THA:TH,TJK:TJ,TKL:TK,TKM:TM,TLS:TL,TON:TO,TTO:TT,TUN:TN,TUR:TR,TUV:TV,TWN:TW,TZA:TZ,UGA:UG,UKR:UA,UMI:UM,URY:UY,USA:US,UZB:UZ,VAT:VA,VCT:VC,VEN:VE,VGB:VG,VIR:VI,VNM:VN,VUT:VU,WLF:WF,WSM:WS,YEM:YE,ZAF:ZA,ZMB:ZM,ZWE:ZW'
    .split(',')
    .map((pair) => pair.split(':')),
) as Record<string, string>;

const COUNTRY_ALIASES: Record<string, string> = {
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  northernireland: 'GB',
  uk: 'GB',
  usa: 'US',
  kosovo: 'XK',
  czechrepublic: 'CZ',
  ivorycoast: 'CI',
  capeverde: 'CV',
  drcongo: 'CD',
  congodr: 'CD',
  democraticrepublicofthecongo: 'CD',
  republicofthecongo: 'CG',
  southkorea: 'KR',
  korearepublic: 'KR',
  northkorea: 'KP',
  holland: 'NL',
  palestine: 'PS',
  russia: 'RU',
  syria: 'SY',
  iran: 'IR',
  tanzania: 'TZ',
  bolivia: 'BO',
  venezuela: 'VE',
  moldova: 'MD',
  brunei: 'BN',
  laos: 'LA',
  vietnam: 'VN',
  thegambia: 'GM',
};

function normalizedCountry(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/g, '');
}

const ISO_ALPHA2 = new Set(Object.values(ISO_ALPHA3));
const COUNTRY_NAMES = (() => {
  const result = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of ISO_ALPHA2) {
      const name = names.of(code);
      if (name) result.set(normalizedCountry(name), code);
    }
  } catch {
    // Alpha-2, alpha-3 and football aliases still cover provider payloads.
  }
  return result;
})();

export function countryCode(country: string, providedCode?: string | null): string | null {
  for (const value of [providedCode, country]) {
    const raw = value?.trim().toUpperCase();
    if (!raw) continue;
    if (ISO_ALPHA2.has(raw) || raw === 'XK') return raw;
    if (ISO_ALPHA3[raw]) return ISO_ALPHA3[raw];
    const normalized = normalizedCountry(value!);
    const resolved = COUNTRY_ALIASES[normalized] ?? COUNTRY_NAMES.get(normalized);
    if (resolved) return resolved;
  }
  return null;
}

function countryFlag(country: string, providedCode?: string | null): string {
  const code = countryCode(country, providedCode);
  if (!code) return '🏳️';
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

export function displayFormRating(current: number, lastFive: number[]): number {
  const values = lastFive.slice(-5);
  if (values.length === 0) return Math.max(0, Math.min(99, Math.round(current)));
  const weights = [0.12, 0.16, 0.19, 0.23, 0.3].slice(-values.length);
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  return Math.max(
    0,
    Math.min(
      99,
      Math.round(
        values.reduce((total, value, index) => total + value * weights[index]!, 0) / weightTotal,
      ),
    ),
  );
}

export const PlayerCard = memo(function PlayerCard({
  lot,
  phase,
}: {
  lot: PublicLot;
  phase: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [crestFailed, setCrestFailed] = useState(false);
  const player = lot.candidate;
  const isManager = player.kind === 'MANAGER';
  const formRating = displayFormRating(player.currentFormRating, player.lastFive);
  useEffect(() => setImageFailed(false), [player.imageUrl]);
  useEffect(() => setCrestFailed(false), [player.clubImageUrl]);
  const marketLabel = isManager
    ? 'MANAGER RESERVE'
    : player.valuation.type === 'market_value'
      ? 'CURRENT MARKET VALUE'
      : player.valuation.type === 'estimated_transfer_value'
        ? 'ESTIMATED TRANSFER VALUE'
        : 'GAVEL XI ESTIMATE';

  const metrics: [string, number][] = isManager
    ? [
        ['Possession', player.tactics?.possession ?? 0],
        ['Pressing', player.tactics?.pressing ?? 0],
        ['Flexibility', player.tactics?.tacticalFlexibility ?? 0],
      ]
    : lot.position === 'GK'
      ? [
          ['Defending', player.role.defending],
          ['Aerial', player.role.aerial],
          ['Composure', player.role.composure],
        ]
      : ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM'].includes(lot.position)
        ? [
            ['Defending', player.role.defending],
            ['Physical', player.role.physical],
            ['Passing', player.role.passing],
          ]
        : ['CM', 'AM'].includes(lot.position)
          ? [
              ['Passing', player.role.passing],
              ['Vision', player.role.creativity],
              ['Technique', player.role.technique],
            ]
          : [
              ['Finishing', player.role.finishing],
              ['Pace', player.role.pace],
              ['Technique', player.role.technique],
            ];

  return (
    <article className={`scout-card scout-card--${phase.toLowerCase()}`} data-testid="player-card">
      <div className="scout-curtain" aria-hidden="true">
        <span>SCOUTING REPORT</span>
        <b>{lot.position}</b>
        <small>IDENTITY CONFIRMED</small>
      </div>
      <header className="scout-card__header">
        <span>{lot.isReturning ? 'BACK ON THE MARKET' : 'SCOUTING DOSSIER'}</span>
        <b>#{String(lot.sequence).padStart(3, '0')}</b>
      </header>
      <div className="scout-card__visual">
        <div className="scout-card__position" data-testid="current-position">
          <strong>{lot.position}</strong>
          <span>{isManager ? 'HEAD COACH' : 'DRAFT POSITION'}</span>
        </div>
        <div className="scout-card__photo">
          {!imageFailed && player.imageUrl ? (
            <img
              src={player.imageUrl}
              alt={player.commonName || player.fullName}
              data-testid="card-portrait"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ImageFallback name={player.commonName || player.fullName} />
          )}
        </div>
        <span
          className="scout-card__country"
          aria-label={`Nationality: ${player.nationality}`}
          data-testid="nationality-flag"
        >
          {countryFlag(player.nationality, player.nationalityCode)} <b>{player.nationality}</b>
        </span>
        <div className="scout-card__rating">
          <b data-testid="card-form-rating">{formRating}</b>
          <span>FORM INDEX</span>
        </div>
      </div>
      <div className="scout-card__identity">
        <p>{isManager ? 'THE MIND BEHIND YOUR XI' : 'YOUR NEXT SIGNING?'}</p>
        <h2 data-testid="revealed-player-name">{player.commonName || player.fullName}</h2>
        <div className="scout-card__club">
          {!crestFailed && player.clubImageUrl ? (
            <img src={player.clubImageUrl} alt="" onError={() => setCrestFailed(true)} />
          ) : (
            <span aria-hidden="true">◇</span>
          )}
          <strong data-testid="card-club-name">{player.club}</strong>
        </div>
        <div className="scout-card__bio" data-testid="player-details">
          <span>{isManager ? 'MANAGER' : `${player.age} YEARS`}</span>
          <span>{player.season}</span>
          <span>{player.positions.join(' / ')}</span>
        </div>
      </div>
      <section className="scout-card__metrics" aria-label="Estimated role profile">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{Math.round(value)}</b>
            <meter min={0} max={100} value={value} aria-label={label} />
          </div>
        ))}
      </section>
      <div className="scout-card__prices">
        <div>
          <span>{marketLabel}</span>
          <strong>{formatMoney(player.valuation.valueEUR, true)}</strong>
        </div>
        <div>
          <span>OPENING BID</span>
          <strong>{formatMoney(lot.openingBidEUR, true)}</strong>
        </div>
      </div>
      <details className="scout-card__source">
        <summary>
          PLAYER DATA & PROFILE ESTIMATES <span>+</span>
        </summary>
        <p>
          {player.dataSource} · Updated {new Date(player.dataUpdatedAt).toLocaleDateString('en-GB')}
        </p>
        <p>
          {player.valuation.source} · Confidence{' '}
          {Math.round(player.valuation.confidence * (player.valuation.confidence <= 1 ? 100 : 1))}%
        </p>
        <p>Role and form indices are game estimates, not verified live match statistics.</p>
      </details>
    </article>
  );
});

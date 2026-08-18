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

  return (
    <article
      className={`player-card player-card--${phase.toLowerCase()} ${lot.isReturning ? 'player-card--returning' : ''}`}
      data-testid="player-card"
    >
      <span className="player-card__cut player-card__cut--one" />
      <span className="player-card__cut player-card__cut--two" />
      <div className="player-card__rail">
        <span>LOT {String(lot.sequence).padStart(2, '0')}</span>
        <span>{player.season}</span>
      </div>
      <div className="player-card__meta">
        <div className="position-stamp" data-testid="current-position">
          <strong>{lot.position}</strong>
          <span>POSITION</span>
        </div>
        <div className="identity-stamp">
          <span
            aria-label={`Nationality: ${player.nationality}`}
            data-testid="nationality-flag"
            title={player.nationality}
          >
            {countryFlag(player.nationality, player.nationalityCode)}
          </span>
          <span aria-label={`Club: ${player.club}`} title={player.club}>
            {!crestFailed && player.clubImageUrl ? (
              <img src={player.clubImageUrl} alt="" onError={() => setCrestFailed(true)} />
            ) : (
              initials(player.club)
            )}
          </span>
        </div>
      </div>
      <div className="player-card__portrait">
        <div className="portrait-halo" />
        {!imageFailed && player.imageUrl ? (
          // Provider URLs are frozen into the room snapshot; layout has a complete fallback if one expires.
          <img
            src={player.imageUrl}
            alt=""
            data-testid="card-portrait"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ImageFallback name={player.commonName || player.fullName} />
        )}
        <div className="portrait-fade" />
      </div>
      <div className="player-card__copy">
        <p className="player-card__kicker">
          {isManager ? 'HEAD COACH' : `${lot.position} · LIVE AUCTION CARD`}
        </p>
        <h2 data-testid="revealed-player-name" title={player.commonName || player.fullName}>
          {player.commonName || player.fullName}
        </h2>
        <p className="player-card__club-name" data-testid="card-club-name" title={player.club}>
          {player.club}
        </p>
        <div className="player-card__bio" data-testid="player-details">
          <span>{isManager ? 'TACTICAL LEAD' : `${player.age} YEARS`}</span>
          <span>{player.season}</span>
          <span>{player.league}</span>
        </div>
        <div className="player-card__numbers">
          <div>
            <span>{marketLabel}</span>
            <strong>{formatMoney(player.valuation.valueEUR, true)}</strong>
          </div>
          <i />
          <div>
            <span>OPENING BID</span>
            <strong>{formatMoney(lot.openingBidEUR, true)}</strong>
          </div>
        </div>
      </div>
      <div className="player-card__form">
        <span>
          FORM <b data-testid="card-form-rating">{formRating}</b>
        </span>
        <div>
          <i style={{ width: `${formRating}%` }} />
        </div>
        <span className="last-five">
          {player.lastFive.slice(0, 5).map((value, index) => (
            <i
              className={value >= 70 ? 'is-win' : value >= 50 ? 'is-draw' : ''}
              key={`${value}-${index}`}
            />
          ))}
        </span>
      </div>
      <details className="player-card__source">
        <summary>DATA PROVENANCE</summary>
        <p>
          {player.dataSource} · Updated {new Date(player.dataUpdatedAt).toLocaleDateString('en-GB')}
        </p>
        <p>
          {player.valuation.source} · Confidence{' '}
          {Math.round(player.valuation.confidence * (player.valuation.confidence <= 1 ? 100 : 1))}%
        </p>
      </details>
    </article>
  );
});

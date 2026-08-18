import type { RoleProfile, TacticalProfile, Valuation } from '@gavel-xi/shared';
import type { NormalizedManager } from './types.js';

interface CuratedManagerInput {
  id: string;
  name: string;
  age: number;
  nationality: string;
  nationalityCode: string;
  club: string;
  league: string;
  rating: number;
  lastFive: [number, number, number, number, number];
  imageUrl: string;
  tactics: TacticalProfile;
}

const UPDATED_AT = '2026-08-18T00:00:00.000Z';

function profile(rating: number, tactics: TacticalProfile): RoleProfile {
  return {
    pace: Math.max(45, rating - 22),
    physical: Math.max(50, rating - 15),
    technique: Math.round((tactics.possession + tactics.buildUpRisk) / 2),
    creativity: Math.round((tactics.tacticalFlexibility + tactics.transition) / 2),
    defending: Math.round((tactics.lowBlock + tactics.pressing) / 2),
    aerial: Math.max(50, rating - 18),
    passing: tactics.possession,
    finishing: Math.max(45, rating - 25),
    pressing: tactics.pressing,
    composure: rating,
  };
}

function valuation(rating: number): Valuation {
  return {
    valueEUR: Math.round((8_000_000 + (rating - 70) * 1_650_000) / 1_000_000) * 1_000_000,
    source: 'GAVEL XI curated manager tier',
    sourceUrl: null,
    valuationDate: '2026-08-18',
    retrievedAt: UPDATED_AT,
    confidence: 0.65,
    type: 'game_estimate',
  };
}

function manager(input: CuratedManagerInput): NormalizedManager {
  return {
    id: `gavel-manager:${input.id}`,
    kind: 'MANAGER',
    fullName: input.name,
    commonName: input.name,
    age: input.age,
    nationality: input.nationality,
    nationalityCode: input.nationalityCode,
    club: input.club,
    league: input.league,
    positions: ['MANAGER'],
    preferredPosition: 'MANAGER',
    imageUrl: input.imageUrl,
    clubImageUrl: null,
    season: 'GAVEL 2026',
    appearances: 38,
    starts: 38,
    minutes: 3_420,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    currentFormRating: input.rating,
    availabilityRating: 96,
    competitionStrength: 94,
    lastFive: input.lastFive,
    role: profile(input.rating, input.tactics),
    tactics: input.tactics,
    valuation: valuation(input.rating),
    dataSource:
      'GAVEL XI curated manager profile; form is a transparent game rating, portrait from Wikimedia Commons',
    dataUpdatedAt: UPDATED_AT,
  };
}

const CURATED_MANAGERS: readonly CuratedManagerInput[] = [
  {
    id: 'jose-mourinho',
    name: 'José Mourinho',
    age: 63,
    nationality: 'Portugal',
    nationalityCode: 'PT',
    club: 'Benfica',
    league: 'Primeira Liga',
    rating: 88,
    lastFive: [86, 89, 87, 90, 88],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Jos%C3%A9_Mourinho_20250206_%281%29.jpg/330px-Jos%C3%A9_Mourinho_20250206_%281%29.jpg',
    tactics: {
      possession: 78,
      pressing: 82,
      transition: 91,
      lowBlock: 94,
      highLine: 69,
      directness: 88,
      widthPreference: 76,
      buildUpRisk: 67,
      tacticalFlexibility: 92,
    },
  },
  {
    id: 'hansi-flick',
    name: 'Hansi Flick',
    age: 61,
    nationality: 'Germany',
    nationalityCode: 'DE',
    club: 'Barcelona',
    league: 'La Liga',
    rating: 93,
    lastFive: [91, 94, 92, 95, 93],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/2022_Hansi_Flick_%28cropped%29.jpg/330px-2022_Hansi_Flick_%28cropped%29.jpg',
    tactics: {
      possession: 91,
      pressing: 95,
      transition: 94,
      lowBlock: 68,
      highLine: 96,
      directness: 86,
      widthPreference: 83,
      buildUpRisk: 89,
      tacticalFlexibility: 90,
    },
  },
  {
    id: 'pep-guardiola',
    name: 'Pep Guardiola',
    age: 55,
    nationality: 'Spain',
    nationalityCode: 'ES',
    club: 'Manchester City',
    league: 'Premier League',
    rating: 92,
    lastFive: [90, 93, 91, 94, 92],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Josep_Guardiola_2023-10-04_Fu%C3%9Fball%2C_M%C3%A4nner%2C_UEFA_Champions_League%2C_RB_Leipzig_-_Manchester_City_FC_1DX_2797_%28cropped%29.jpg/330px-Josep_Guardiola_2023-10-04_Fu%C3%9Fball%2C_M%C3%A4nner%2C_UEFA_Champions_League%2C_RB_Leipzig_-_Manchester_City_FC_1DX_2797_%28cropped%29.jpg',
    tactics: {
      possession: 98,
      pressing: 92,
      transition: 82,
      lowBlock: 62,
      highLine: 93,
      directness: 70,
      widthPreference: 91,
      buildUpRisk: 95,
      tacticalFlexibility: 96,
    },
  },
  {
    id: 'jurgen-klopp',
    name: 'Jürgen Klopp',
    age: 59,
    nationality: 'Germany',
    nationalityCode: 'DE',
    club: 'Liverpool',
    league: 'Premier League',
    rating: 89,
    lastFive: [88, 90, 91, 87, 89],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/2022-07-21_Fu%C3%9Fball%2C_M%C3%A4nner%2CFreundschaftsspiel%2C_RB_Leipzig_-_FC_Liverpool_1DX_2243_by_Stepro_%28cropped%29_%28cropped%29.jpg/330px-2022-07-21_Fu%C3%9Fball%2C_M%C3%A4nner%2CFreundschaftsspiel%2C_RB_Leipzig_-_FC_Liverpool_1DX_2243_by_Stepro_%28cropped%29_%28cropped%29.jpg',
    tactics: {
      possession: 84,
      pressing: 98,
      transition: 96,
      lowBlock: 65,
      highLine: 91,
      directness: 91,
      widthPreference: 88,
      buildUpRisk: 83,
      tacticalFlexibility: 88,
    },
  },
  {
    id: 'xabi-alonso',
    name: 'Xabi Alonso',
    age: 44,
    nationality: 'Spain',
    nationalityCode: 'ES',
    club: 'Bayer Leverkusen',
    league: 'Bundesliga',
    rating: 87,
    lastFive: [90, 88, 85, 87, 86],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Los_Caminos_del_f%C3%BAtbol._Xabi_Alonso_%2839666778464%29_%28cropped%29.jpg/330px-Los_Caminos_del_f%C3%BAtbol._Xabi_Alonso_%2839666778464%29_%28cropped%29.jpg',
    tactics: {
      possession: 91,
      pressing: 86,
      transition: 90,
      lowBlock: 74,
      highLine: 87,
      directness: 80,
      widthPreference: 92,
      buildUpRisk: 91,
      tacticalFlexibility: 90,
    },
  },
  {
    id: 'carlo-ancelotti',
    name: 'Carlo Ancelotti',
    age: 67,
    nationality: 'Italy',
    nationalityCode: 'IT',
    club: 'Brazil',
    league: 'International',
    rating: 92,
    lastFive: [93, 91, 94, 90, 92],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Carlo_Ancelotti_Brazil_V_Morocco_13_June_2026-47.jpg/330px-Carlo_Ancelotti_Brazil_V_Morocco_13_June_2026-47.jpg',
    tactics: {
      possession: 89,
      pressing: 83,
      transition: 92,
      lowBlock: 80,
      highLine: 82,
      directness: 85,
      widthPreference: 87,
      buildUpRisk: 84,
      tacticalFlexibility: 98,
    },
  },
  {
    id: 'lionel-scaloni',
    name: 'Lionel Scaloni',
    age: 48,
    nationality: 'Argentina',
    nationalityCode: 'AR',
    club: 'Argentina',
    league: 'International',
    rating: 91,
    lastFive: [92, 90, 93, 91, 89],
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Lionel_Scaloni_Argentina_v_Spain_19_July_2026-239_%28cropped%29.jpg/330px-Lionel_Scaloni_Argentina_v_Spain_19_July_2026-239_%28cropped%29.jpg',
    tactics: {
      possession: 87,
      pressing: 90,
      transition: 94,
      lowBlock: 84,
      highLine: 85,
      directness: 88,
      widthPreference: 86,
      buildUpRisk: 82,
      tacticalFlexibility: 95,
    },
  },
];

export function curatedManagers(): NormalizedManager[] {
  return CURATED_MANAGERS.map((entry) => manager(entry));
}

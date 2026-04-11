/**
 * Geographic regions used for badge geo-targeting.
 * Codes are stored as "COUNTRY-PROVINCE" (e.g. "US-CA") for state/province-level
 * or just "COUNTRY" (e.g. "US") for country-level targeting.
 *
 * Province codes match what Shopify's Liquid outputs via
 * customer.default_address.province_code — no country prefix in those values.
 * We prepend the country when storing to keep codes globally unique.
 */

export type GeoProvince = { code: string; name: string };
export type GeoCountry = {
  countryCode: string;
  countryName: string;
  flag: string;
  provinces: GeoProvince[];
};

export const GEO_REGIONS: GeoCountry[] = [
  {
    countryCode: "US",
    countryName: "United States",
    flag: "🇺🇸",
    provinces: [
      { code: "US-AL", name: "Alabama" },
      { code: "US-AK", name: "Alaska" },
      { code: "US-AZ", name: "Arizona" },
      { code: "US-AR", name: "Arkansas" },
      { code: "US-CA", name: "California" },
      { code: "US-CO", name: "Colorado" },
      { code: "US-CT", name: "Connecticut" },
      { code: "US-DE", name: "Delaware" },
      { code: "US-FL", name: "Florida" },
      { code: "US-GA", name: "Georgia" },
      { code: "US-HI", name: "Hawaii" },
      { code: "US-ID", name: "Idaho" },
      { code: "US-IL", name: "Illinois" },
      { code: "US-IN", name: "Indiana" },
      { code: "US-IA", name: "Iowa" },
      { code: "US-KS", name: "Kansas" },
      { code: "US-KY", name: "Kentucky" },
      { code: "US-LA", name: "Louisiana" },
      { code: "US-ME", name: "Maine" },
      { code: "US-MD", name: "Maryland" },
      { code: "US-MA", name: "Massachusetts" },
      { code: "US-MI", name: "Michigan" },
      { code: "US-MN", name: "Minnesota" },
      { code: "US-MS", name: "Mississippi" },
      { code: "US-MO", name: "Missouri" },
      { code: "US-MT", name: "Montana" },
      { code: "US-NE", name: "Nebraska" },
      { code: "US-NV", name: "Nevada" },
      { code: "US-NH", name: "New Hampshire" },
      { code: "US-NJ", name: "New Jersey" },
      { code: "US-NM", name: "New Mexico" },
      { code: "US-NY", name: "New York" },
      { code: "US-NC", name: "North Carolina" },
      { code: "US-ND", name: "North Dakota" },
      { code: "US-OH", name: "Ohio" },
      { code: "US-OK", name: "Oklahoma" },
      { code: "US-OR", name: "Oregon" },
      { code: "US-PA", name: "Pennsylvania" },
      { code: "US-RI", name: "Rhode Island" },
      { code: "US-SC", name: "South Carolina" },
      { code: "US-SD", name: "South Dakota" },
      { code: "US-TN", name: "Tennessee" },
      { code: "US-TX", name: "Texas" },
      { code: "US-UT", name: "Utah" },
      { code: "US-VT", name: "Vermont" },
      { code: "US-VA", name: "Virginia" },
      { code: "US-WA", name: "Washington" },
      { code: "US-WV", name: "West Virginia" },
      { code: "US-WI", name: "Wisconsin" },
      { code: "US-WY", name: "Wyoming" },
      { code: "US-DC", name: "District of Columbia" },
      { code: "US-PR", name: "Puerto Rico" },
      { code: "US-VI", name: "Virgin Islands" },
      { code: "US-GU", name: "Guam" },
    ],
  },
  {
    countryCode: "CA",
    countryName: "Canada",
    flag: "🇨🇦",
    provinces: [
      { code: "CA-AB", name: "Alberta" },
      { code: "CA-BC", name: "British Columbia" },
      { code: "CA-MB", name: "Manitoba" },
      { code: "CA-NB", name: "New Brunswick" },
      { code: "CA-NL", name: "Newfoundland and Labrador" },
      { code: "CA-NT", name: "Northwest Territories" },
      { code: "CA-NS", name: "Nova Scotia" },
      { code: "CA-NU", name: "Nunavut" },
      { code: "CA-ON", name: "Ontario" },
      { code: "CA-PE", name: "Prince Edward Island" },
      { code: "CA-QC", name: "Quebec" },
      { code: "CA-SK", name: "Saskatchewan" },
      { code: "CA-YT", name: "Yukon" },
    ],
  },
  {
    countryCode: "AU",
    countryName: "Australia",
    flag: "🇦🇺",
    provinces: [
      { code: "AU-ACT", name: "Australian Capital Territory" },
      { code: "AU-NSW", name: "New South Wales" },
      { code: "AU-NT", name: "Northern Territory" },
      { code: "AU-QLD", name: "Queensland" },
      { code: "AU-SA", name: "South Australia" },
      { code: "AU-TAS", name: "Tasmania" },
      { code: "AU-VIC", name: "Victoria" },
      { code: "AU-WA", name: "Western Australia" },
    ],
  },
  {
    countryCode: "GB",
    countryName: "United Kingdom",
    flag: "🇬🇧",
    provinces: [
      { code: "GB-ENG", name: "England" },
      { code: "GB-SCT", name: "Scotland" },
      { code: "GB-WLS", name: "Wales" },
      { code: "GB-NIR", name: "Northern Ireland" },
    ],
  },
  {
    countryCode: "DE",
    countryName: "Germany",
    flag: "🇩🇪",
    provinces: [
      { code: "DE-BW", name: "Baden-Württemberg" },
      { code: "DE-BY", name: "Bavaria" },
      { code: "DE-BE", name: "Berlin" },
      { code: "DE-BB", name: "Brandenburg" },
      { code: "DE-HB", name: "Bremen" },
      { code: "DE-HH", name: "Hamburg" },
      { code: "DE-HE", name: "Hesse" },
      { code: "DE-MV", name: "Mecklenburg-Vorpommern" },
      { code: "DE-NI", name: "Lower Saxony" },
      { code: "DE-NW", name: "North Rhine-Westphalia" },
      { code: "DE-RP", name: "Rhineland-Palatinate" },
      { code: "DE-SL", name: "Saarland" },
      { code: "DE-SN", name: "Saxony" },
      { code: "DE-ST", name: "Saxony-Anhalt" },
      { code: "DE-SH", name: "Schleswig-Holstein" },
      { code: "DE-TH", name: "Thuringia" },
    ],
  },
];

/**
 * Countries where we only support country-level targeting (no province breakdown).
 * Used in the "Other countries" section of the geo picker.
 */
export const COUNTRY_ONLY: Array<{ code: string; name: string; flag: string }> = [
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
];

/**
 * Given stored geo target codes like ["US-CA", "CA-ON", "AU"],
 * returns a human-readable summary string.
 */
export function geoTargetSummary(targets: string[]): string {
  if (!targets || targets.length === 0) return "All regions";

  const countryGroups: Record<string, string[]> = {};
  for (const code of targets) {
    const [country] = code.split("-");
    if (!countryGroups[country]) countryGroups[country] = [];
    countryGroups[country].push(code);
  }

  const parts: string[] = [];
  for (const [country, codes] of Object.entries(countryGroups)) {
    const regionData = GEO_REGIONS.find((r) => r.countryCode === country);
    if (!regionData) {
      // Country-only
      const co = COUNTRY_ONLY.find((c) => c.code === country);
      parts.push(co ? co.name : country);
      continue;
    }
    // If all provinces selected, just show country name
    if (codes.length >= regionData.provinces.length) {
      parts.push(regionData.countryName);
    } else if (codes.length === 1) {
      const prov = regionData.provinces.find((p) => p.code === codes[0]);
      parts.push(prov ? prov.name : codes[0]);
    } else {
      parts.push(`${regionData.flag} ${codes.length} ${regionData.countryName} regions`);
    }
  }

  if (parts.length > 3) {
    return `${parts.slice(0, 3).join(", ")} +${parts.length - 3} more`;
  }
  return parts.join(", ");
}

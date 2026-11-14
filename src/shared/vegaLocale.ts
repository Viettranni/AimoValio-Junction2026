// Finnish number and date formats for Vega charts (d3 locale definitions): 10 961 €, 7,7, "tammi 25".
export const FORMAT_LOCALE = {
  decimal: ',', thousands: ' ', grouping: [3], currency: ['', ' €'],
};

export const TIME_FORMAT_LOCALE = {
  dateTime: '%A %-d.%-m.%Y klo %X', date: '%-d.%-m.%Y', time: '%H:%M:%S', periods: ['ap.', 'ip.'],
  days: ['sunnuntai', 'maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai'],
  shortDays: ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'],
  months: ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'],
  shortMonths: ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'],
};

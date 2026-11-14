// Finnish names for the values in the ported data (the export is English). Applied once, when the data is loaded,
// so every query, chart and caption downstream already speaks Finnish. Product and brand names are left as they are.

export const WEEKDAYS_FI = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
export const MONTHS_FI = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];

const WEEKDAY_EN: Record<string, string> = { Mon: 'ma', Tue: 'ti', Wed: 'ke', Thu: 'to', Fri: 'pe', Sat: 'la', Sun: 'su' };

export const CATEGORY_FI: Record<string, string> = {
  Dairy: 'Maitotuotteet', 'Plant-based': 'Kasvipohjaiset', 'Fruit & veg': 'Hedelmät ja vihannekset', Meat: 'Liha',
  Fish: 'Kala', Bakery: 'Leipomotuotteet', 'Dry goods': 'Kuivatuotteet',
};

/** Category codes of the demand dataset and portion categories of this app's own orders. */
export const CATEGORY_CODE_FI: Record<string, string> = {
  dairy: 'Maitotuotteet', plant_based: 'Kasvipohjaiset', produce: 'Hedelmät ja vihannekset', meat: 'Liha', fish: 'Kala',
  bakery: 'Leipomotuotteet', dry_goods: 'Kuivatuotteet', other: 'Muu',
  poultry_main: 'Siipikarjan pääruoka', meat_main: 'Lihan pääruoka', fish_main: 'Kalan pääruoka', veg_main: 'Kasvispääruoka',
  grain_side: 'Viljalisäke', potato_side: 'Perunalisäke', veg_side: 'Kasvislisäke', salad: 'Salaatti', sauce: 'Kastike',
  bread: 'Leipä', dessert: 'Jälkiruoka', beverage: 'Juoma', cooking_fat: 'Ruokaöljy ja rasva', seasoning: 'Mausteet',
};

export const EVENT_TYPE_FI: Record<string, string> = {
  Gala: 'Gaala', Wedding: 'Häät', Conference: 'Konferenssi', 'Christmas party': 'Pikkujoulu', Birthday: 'Syntymäpäivä', Lunch: 'Lounas',
};

/** Event types of this app's orders. */
export const PROJECT_EVENT_TYPE_FI: Record<string, string> = {
  wedding: 'Häät', corporate_lunch: 'Yrityslounas', party: 'Juhlat', buffet: 'Noutopöytä', school: 'Koulu', other: 'Muu',
};

export const STORAGE_FI = { chilled: 'Kylmä', ambient: 'Huoneenlämpö ja pakaste', en: { Chilled: 'Kylmä', 'Ambient & frozen': 'Huoneenlämpö ja pakaste' } as Record<string, string> };

const SITE_FI: Record<string, string> = {
  'Kaarela production kitchen': 'Kaarelan tuotantokeittiö',
  'Kaari Hospital central kitchen': 'Kaari-sairaalan keskuskeittiö',
  'Kannelmäki school kitchen': 'Kannelmäen koulukeittiö',
  'Kahvila Uusi kitchen': 'Kahvila Uusi',
};
const SITE_TYPE_FI: Record<string, string> = {
  'Central kitchen · hotel restaurant': 'Keskuskeittiö · hotelliravintola', 'Hotel restaurant': 'Hotelliravintola',
  'Hotel restaurant + events': 'Hotelliravintola + tapahtumat', 'Patient meals': 'Potilasruokailu',
  'School meals · 12 schools': 'Kouluruoka · 12 koulua', 'School meals · 4 schools': 'Kouluruoka · 4 koulua',
  'Café · opened this week': 'Kahvila · avattu tällä viikolla',
};
const SEGMENT_FI: Record<string, string> = {
  'Hotel chain': 'Hotelliketju', 'Hospital kitchen': 'Sairaalakeittiö', 'School catering (12 schools)': 'Koulukeittiöt (12 koulua)',
  'New café kitchen (opened this week)': 'Uusi kahvilakeittiö (avattu tällä viikolla)',
};
const ROLE_FI: Record<string, string> = {
  'Head of Procurement': 'Hankintapäällikkö', 'Executive Chef': 'Keittiömestari', 'Head of Clinical Nutrition': 'Kliinisen ravitsemuksen johtaja',
  'Kitchen Manager': 'Keittiöpäällikkö', 'Catering Manager': 'Ruokapalvelupäällikkö', Owner: 'Omistaja',
};
const BUYER_FI: Record<string, string> = {
  'Kaari Hospital – Central Kitchen': 'Kaari-sairaala – keskuskeittiö', 'Kaarela School Kitchens': 'Kaarelan koulukeittiöt',
};
const ALLERGEN_FI: Record<string, string> = { nuts: 'pähkinät', peanuts: 'maapähkinät', milk: 'maito', sesame: 'seesami', fish: 'kala', eggs: 'kananmuna' };
const PRODUCT_FI: Record<string, string> = {
  'Almond drink, unsweetened 1 L': 'Makeuttamaton mantelijuoma 1 l',
  'Apples, Finnish 8 kg': 'Suomalaiset omenat 8 kg',
  'Arborio risotto rice 5 kg': 'Arborio-risottoriisi 5 kg',
  'Bacon slices 1 kg': 'Pekoniviipaleet 1 kg',
  'Baltic herring fillets 3 kg': 'Itämerensilakkafileet 3 kg',
  'Bananas 18 kg': 'Banaanit 18 kg',
  'Barista oat drink 1 L': 'Baristakaurajuoma 1 l',
  'Beef tenderloin, trimmed, approx. 2.5 kg': 'Naudan sisäfilee, siistitty, noin 2,5 kg',
  'Beetroot, cooked & peeled 5 kg': 'Keitetyt ja kuoritut punajuuret 5 kg',
  'Black tea, 100 bags': 'Musta tee, 100 pussia',
  'Blue mussels, cooked 1 kg': 'Kypsät sinisimpukat 1 kg',
  'Butter 82% unsalted 500 g': 'Suolaton voi 82 %, 500 g',
  'Butter croissants, frozen 48 pcs': 'Voi-croissantit, pakaste, 48 kpl',
  'Carrots 10 kg': 'Porkkanat 10 kg',
  'Celery stalks 5 kg': 'Varsiselleri 5 kg',
  'Champignons 3 kg': 'Herkkusienet 3 kg',
  'Chicken breast fillet 2.5 kg': 'Broilerin rintafilee 2,5 kg',
  'Chickpeas in brine 2.5 kg': 'Kikherneet suolaliemessä 2,5 kg',
  'Christmas ham, cured, whole approx. 8 kg': 'Suolattu joulukinkku, kokonainen, noin 8 kg',
  'Cinnamon buns, frozen 40 pcs': 'Korvapuustit, pakaste, 40 kpl',
  'Cod loin, frozen 4 kg': 'Turskan selkäfilee, pakaste, 4 kg',
  'Cold-pressed rapeseed oil 5 L': 'Kylmäpuristettu rypsiöljy 5 l',
  'Crushed tomatoes 2.5 kg can': 'Tomaattimurska, 2,5 kg:n tölkki',
  'Cucumbers, greenhouse 5 kg': 'Kasvihuonekurkut 5 kg',
  'Dark chocolate couverture 70% 2.5 kg': 'Tumma couverture-suklaa 70 %, 2,5 kg',
  'Dark chocolate drops 60%, nut-free facility 2 kg': 'Tummat suklaanapit 60 %, valmistettu pähkinättömässä tilassa, 2 kg',
  'Dark roast ground coffee 1 kg': 'Tummapaahtoinen kahvi, jauhettu, 1 kg',
  'Dijon mustard 1 kg': 'Dijoninsinappi 1 kg',
  'Dried cranberries 1 kg': 'Kuivatut karpalot 1 kg',
  'Durum wheat penne 5 kg': 'Durumvehnäpenne 5 kg',
  'Edam cheese slices 1 kg': 'Edamjuustoviipaleet 1 kg',
  'Emmental cheese block approx. 3 kg': 'Emmentaljuusto, pala, noin 3 kg',
  'Falafel balls, frozen 1 kg': 'Falafelpyörykät, pakaste, 1 kg',
  'Free-range eggs M, 30-egg tray': 'Ulkokananmunat M, 30 kpl:n kenno',
  'Fresh dill 0.5 kg': 'Tuore tilli 0,5 kg',
  'Gluten-free corn-rice penne 2 kg': 'Gluteeniton maissi-riisipenne 2 kg',
  'Gluten-free oat flakes 3 kg': 'Gluteenittomat kaurahiutaleet 3 kg',
  'Gluten-free seeded bread 500 g': 'Gluteeniton siemenleipä 500 g',
  'Granulated sugar 25 kg': 'Kidesokeri 25 kg',
  'Grill sausages 1 kg': 'Grillimakkarat 1 kg',
  'Hazelnut drink 1 L': 'Hasselpähkinäjuoma 1 l',
  'Hulled sesame seeds 1 kg': 'Kuoritut seesaminsiemenet 1 kg',
  'Iceberg lettuce, 10 heads': 'Jäävuorisalaatti, 10 kpl',
  'Jasmine rice 10 kg': 'Jasmiiniriisi 10 kg',
  'Karelian rice pies, frozen 60 pcs': 'Karjalanpiirakat, pakaste, 60 kpl',
  'Lactose-free Greek-style yogurt 10% 5 kg': 'Laktoositon kreikkalaistyylinen jogurtti 10 %, 5 kg',
  'Lactose-free cooking cream 15% 1 L': 'Laktoositon ruokakerma 15 %, 1 l',
  'Lactose-free semi-skimmed milk 1.5% 1.5 L': 'Laktoositon kevytmaito 1,5 %, 1,5 l',
  'Lactose-free semi-skimmed milk drink 1.5% 1 L': 'Laktoositon kevytmaitojuoma 1,5 %, 1 l',
  'Lactose-free whipping cream 35% 1 L': 'Laktoositon vispikerma 35 %, 1 l',
  'Lactose-free whole milk 3.5% 1 L': 'Laktoositon täysmaito 3,5 %, 1 l',
  'Lemons 5 kg': 'Sitruunat 5 kg',
  'Lingonberries, frozen 2 kg': 'Puolukat, pakaste, 2 kg',
  'Medium roast whole beans 1 kg': 'Keskipaahtoiset kahvipavut 1 kg',
  'Minced beef 10% 2 kg': 'Naudan jauheliha 10 %, 2 kg',
  'Natural yogurt 2.5% 10 kg bucket': 'Maustamaton jogurtti 2,5 %, 10 kg:n sanko',
  'Oat cooking base 15% 1 L': 'Kaurapohjainen ruokavalmiste 15 %, 1 l',
  'Oat drink, enriched 1 L': 'Täydennetty kaurajuoma 1 l',
  'Oat-based yogurt alternative, plain 5 kg': 'Maustamaton kaurapohjainen jogurttivaihtoehto 5 kg',
  'Organic firm tofu 1 kg': 'Luomutofu, kiinteä, 1 kg',
  'Organic semi-skimmed milk 1.5% 1 L': 'Luomukevytmaito 1,5 %, 1 l',
  'Pasteurised liquid whole egg 1 L': 'Pastöroitu nestemäinen kananmuna 1 l',
  'Pea protein drink 1 L': 'Herneproteiinijuoma 1 l',
  'Pea-based plant mince 2 kg': 'Hernepohjainen kasvisjauhis 2 kg',
  'Peanut butter, smooth 3 kg': 'Sileä maapähkinävoi 3 kg',
  'Peeled potatoes, vacuum 5 kg': 'Kuoritut perunat, vakuumipakattu, 5 kg',
  'Pickled cucumbers 2.5 kg': 'Maustekurkut 2,5 kg',
  'Pike-perch fillet, wild 3 kg': 'Luonnonkuhan filee 3 kg',
  'Plain quark 5 kg': 'Maustamaton maitorahka 5 kg',
  'Plant-based spread 60% 400 g': 'Kasvipohjainen levite 60 %, 400 g',
  'Pork tenderloin 2 kg': 'Porsaan sisäfilee 2 kg',
  'Porridge rice, round grain 5 kg': 'Pyöreäjyväinen puuroriisi 5 kg',
  'Potatoes, firm (yellow) 10 kg sack': 'Kiinteämaltoiset keltaiset perunat, 10 kg:n säkki',
  'Rainbow trout fillet, Finnish 5 kg': 'Suomalainen kirjolohifilee 5 kg',
  'Red lentils 5 kg': 'Punaiset linssit 5 kg',
  'Reindeer sauté, frozen 1 kg': 'Poronkäristys, pakaste, 1 kg',
  'Rolled oat flakes 5 kg': 'Kaurahiutaleet 5 kg',
  'Salmon fillet, skin-on, fresh 5 kg box': 'Lohifilee nahkoineen, tuore, 5 kg:n laatikko',
  'Sea salt, fine 5 kg': 'Hieno merisuola 5 kg',
  'Semi-skimmed milk 1.5% 1 L': 'Kevytmaito 1,5 %, 1 l',
  'Shrimps, cooked & peeled 1 kg': 'Kypsät ja kuoritut katkaravut 1 kg',
  'Skimmed milk 0% 1 L': 'Rasvaton maito 0 %, 1 l',
  'Smetana sour cream 20% 1 kg': 'Smetana 20 %, 1 kg',
  'Smoked ham slices 1 kg': 'Savukinkkuviipaleet 1 kg',
  'Sourdough rye bread, sliced 1 kg': 'Viipaloitu hapanjuurileipä rukiista 1 kg',
  'Soy drink, calcium-enriched 1 L': 'Kalsiumilla täydennetty soijajuoma 1 l',
  'Soy sauce 1.8 L': 'Soijakastike 1,8 l',
  'Strawberries, frozen 2.5 kg': 'Mansikat, pakaste, 2,5 kg',
  'Swede (lanttu) 10 kg': 'Lanttu 10 kg',
  'Tomatoes, greenhouse 6 kg': 'Kasvihuonetomaatit 6 kg',
  'Wheat bread rolls 60 g, frozen 50 pcs': 'Vehnäsämpylät 60 g, pakaste, 50 kpl',
  'Wheat flour, all-purpose 10 kg': 'Vehnäjauho, yleisjauho, 10 kg',
  'Wheat sourdough loaf 700 g': 'Vehnähapanjuurileipä 700 g',
  'Whipping cream 35% 1 L': 'Kuohukerma 35 %, 1 l',
  'White brine cheese cubes 2 kg': 'Valkojuustokuutiot suolaliemessä 2 kg',
  'Wild blueberries, frozen 2 kg': 'Mustikat, pakaste, 2 kg',
  'Yellow onions 10 kg': 'Keltasipulit 10 kg',
};

const lookup = (map: Record<string, string>, v: string) => map[v] ?? v;

export const fiWeekday = (v: string) => lookup(WEEKDAY_EN, v);
export const fiCategory = (v: string) => lookup(CATEGORY_FI, v);
export const fiCategoryCode = (v: string) => lookup(CATEGORY_CODE_FI, v);
export const fiEventType = (v: string) => lookup(EVENT_TYPE_FI, v);
export const fiStorage = (v: string) => lookup(STORAGE_FI.en, v);
export const fiSite = (v: string) => lookup(SITE_FI, v);
export const fiSiteType = (v: string) => lookup(SITE_TYPE_FI, v);
export const fiSegment = (v: string) => lookup(SEGMENT_FI, v);
export const fiRole = (v: string) => lookup(ROLE_FI, v);
export const fiBuyer = (v: string) => lookup(BUYER_FI, v);
export const fiAllergen = (v: string) => lookup(ALLERGEN_FI, v);
export const fiProduct = (v: string) => lookup(PRODUCT_FI, v);

/** "Gala 12.3. Helsinki" -> "Gaala 12.3. Helsinki". */
export function fiEventName(v: string): string {
  const prefix = Object.keys(EVENT_TYPE_FI).find((p) => v.startsWith(`${p} `));
  return prefix ? EVENT_TYPE_FI[prefix] + v.slice(prefix.length) : v;
}

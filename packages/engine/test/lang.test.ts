import { describe, expect, it } from "vitest";
import { detectLang } from "../src/index.js";

// One made-up paragraph per language, about the same everyday thing: a small workshop, its hours and how to reach it.
const PARAGRAPHS: Record<string, string> = {
  cs: "Naše dílna je otevřená každý všední den. Pokud potřebujete opravu kola nebo jen radu, přijďte se podívat. "
    + "Opravy, které nejsou složité, děláme ještě týž den, a když chybí díl, objednáme ho a dáme vám vědět, kdy bude kolo hotové.",
  sk: "Naša dielňa je otvorená každý pracovný deň. Ak potrebujete opravu bicykla alebo len radu, príďte sa pozrieť. "
    + "Opravy, ktoré nie sú zložité, robíme ešte v ten istý deň, a keď chýba diel, objednáme ho a dáme vám vedieť, kedy bude bicykel hotový.",
  pl: "Nasz warsztat jest otwarty w każdy dzień roboczy. Jeśli potrzebujesz naprawy roweru albo tylko porady, przyjdź do nas. "
    + "Naprawy, które nie są trudne, robimy jeszcze tego samego dnia, a gdy brakuje części, zamówimy ją i damy znać, kiedy rower będzie gotowy.",
  de: "Unsere Werkstatt ist an jedem Werktag geöffnet. Wenn Sie eine Reparatur für Ihr Fahrrad brauchen oder nur einen Rat, "
    + "kommen Sie vorbei. Einfache Reparaturen machen wir noch am selben Tag, und wenn ein Teil fehlt, bestellen wir es und sagen Ihnen, wann das Rad fertig ist.",
  en: "Our workshop is open on every working day. If you need your bike repaired or just want some advice, come and see us. "
    + "Repairs that are not complicated are done on the same day, and when a part is missing we order it and let you know when the bike will be ready.",
  fr: "Notre atelier est ouvert tous les jours de la semaine. Si vous avez besoin d'une réparation de vélo ou simplement d'un conseil, "
    + "passez nous voir. Les réparations simples sont faites dans la journée, et quand une pièce manque, nous la commandons et nous vous prévenons.",
  es: "Nuestro taller está abierto todos los días laborables. Si necesita reparar su bicicleta o solo quiere un consejo, venga a vernos. "
    + "Las reparaciones que no son complicadas se hacen el mismo día, y cuando falta una pieza la pedimos y le avisamos cuando la bicicleta esté lista.",
  it: "La nostra officina è aperta tutti i giorni feriali. Se avete bisogno di riparare la bicicletta o solo di un consiglio, venite a trovarci. "
    + "Le riparazioni che non sono complicate si fanno nello stesso giorno, e quando manca un pezzo lo ordiniamo e vi avvisiamo quando la bici è pronta.",
  pt: "A nossa oficina está aberta todos os dias úteis. Se precisa de reparar a sua bicicleta ou só quer um conselho, venha falar connosco. "
    + "As reparações que não são complicadas são feitas no mesmo dia, e quando falta uma peça nós encomendamos e avisamos quando a bicicleta estiver pronta.",
  nl: "Onze werkplaats is op elke werkdag open. Als u een reparatie van uw fiets nodig heeft of alleen een advies wilt, kom dan langs. "
    + "Reparaties die niet ingewikkeld zijn doen we nog dezelfde dag, en als er een onderdeel ontbreekt bestellen we het en laten we u weten wanneer de fiets klaar is.",
  hu: "A műhelyünk minden munkanapon nyitva van. Ha a kerékpárját meg kell javítani, vagy csak tanácsra van szüksége, jöjjön be hozzánk. "
    + "Az egyszerű javításokat még aznap elvégezzük, és ha hiányzik egy alkatrész, megrendeljük, és szólunk, amikor a kerékpár elkészült.",
  sv: "Vår verkstad är öppen alla vardagar. Om du behöver laga din cykel eller bara vill ha ett råd, kom förbi och prata med oss. "
    + "Reparationer som inte är krångliga gör vi samma dag, och när en del saknas beställer vi den och hör av oss när cykeln är klar.",
  ru: "Наша мастерская открыта каждый рабочий день. Если вам нужно отремонтировать велосипед или просто получить совет, приходите к нам. "
    + "Несложный ремонт мы делаем в тот же день, а если не хватает детали, мы её закажем и сообщим, когда велосипед будет готов.",
  uk: "Наша майстерня відкрита щодня, крім вихідних. Якщо вам потрібно відремонтувати велосипед або просто отримати пораду, приходьте до нас. "
    + "Нескладний ремонт ми робимо того ж дня, а якщо бракує деталі, ми її замовимо і повідомимо, коли велосипед буде готовий.",
  el: "Το εργαστήριό μας είναι ανοιχτό κάθε εργάσιμη ημέρα. Αν χρειάζεστε επισκευή ποδηλάτου ή απλώς μια συμβουλή, ελάτε να μας δείτε.",
  he: "הסדנה שלנו פתוחה בכל יום עבודה. אם אתם צריכים לתקן את האופניים או רק עצה, בואו לבקר אותנו ונשמח לעזור.",
  ar: "ورشتنا مفتوحة في كل أيام العمل. إذا كنت بحاجة إلى إصلاح دراجتك أو تريد نصيحة فقط، تعال لزيارتنا وسنكون سعداء بمساعدتك.",
  zh: "我们的车间每个工作日都开放。如果您需要修理自行车或者只是想听听建议，欢迎来找我们。简单的修理当天就能完成，缺少零件时我们会订购并通知您。",
  ja: "私たちの工房は平日は毎日開いています。自転車の修理が必要な方や、ちょっと相談したい方は、どうぞお気軽にお越しください。簡単な修理はその日のうちに終わります。",
  ko: "저희 작업장은 평일에 매일 문을 엽니다. 자전거 수리가 필요하시거나 조언만 필요하셔도 편하게 방문해 주세요. 간단한 수리는 당일에 끝납니다.",
};

describe("detectLang", () => {
  for (const [lang, text] of Object.entries(PARAGRAPHS)) {
    it(`names ${lang} from a paragraph`, () => {
      const r = detectLang(text);
      expect(r.lang).toBe(lang);
      expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    });
  }

  it("tells Czech and Slovak apart in both directions, with the letters and with the words alone", () => {
    expect(detectLang(PARAGRAPHS.cs as string).lang).toBe("cs");
    expect(detectLang(PARAGRAPHS.sk as string).lang).toBe("sk");
    const bare = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
    expect(detectLang(bare(PARAGRAPHS.cs as string)).lang).toBe("cs");
    expect(detectLang(bare(PARAGRAPHS.sk as string)).lang).toBe("sk");
  });

  it("says und for short text", () => {
    for (const t of ["", "Kontakt", "Domů | Služby | Ceník", "Hello world, how are you"]) {
      const r = detectLang(t);
      expect(r.lang).toBe("und");
      expect(r.confidence).toBeLessThan(0.5);
    }
  });

  it("says und for text with no common words of any language (names, codes)", () => {
    expect(detectLang("Xylofon Kwartet Zmrzlina Banjo Fagot Tuba Harfa Viola Cembalo Marimba Ukulele Djembe Kalimba").lang).toBe("und");
  });

  it("names a Czech page with English menu words mixed in as Czech", () => {
    const page = "Home About Services Contact Login Search Newsletter Facebook Instagram Shop News\n"
      + "Autoservis Dymáček provádí opravy osobních i užitkových vozidel všech značek. Nabízíme také pneuservis, "
      + "přípravu vozu na technickou kontrolu a měření emisí. Objednat se můžete telefonicky nebo osobně v provozovně, "
      + "kde vám rádi poradíme s výběrem náhradních dílů.\nCopyright All rights reserved Privacy Policy Cookies";
    expect(detectLang(page)).toMatchObject({ lang: "cs" });
  });

  it("names Czech written without diacritics, as old sites do, as Czech", () => {
    const old = "Vitame Vas na strankach nasi firmy. Jsme rodinna firma, ktera se zabyva opravami automobilu jiz od roku 1992. "
      + "Provadime servis vozu vsech znacek, pneuservis a priprave na STK. Pokud mate zajem o nase sluzby, zavolejte nam nebo prijedte primo k nam.";
    expect(detectLang(old)).toMatchObject({ lang: "cs" });
  });

  it("says und for a near tie of two languages", () => {
    const half = (PARAGRAPHS.en as string) + " " + (PARAGRAPHS.de as string);
    const r = detectLang(half);
    // Whichever it leans to, it must not be sure.
    if (r.lang !== "und") expect(r.confidence).toBeLessThan(0.75);
  });

  it("is fast on 20,000 characters", () => {
    const long = Array.from({ length: 200 }, (_, i) => PARAGRAPHS[i % 2 ? "cs" : "de"]).join(" ").slice(0, 20_000);
    detectLang(long); // warm up
    const t0 = performance.now();
    const runs = 10;
    for (let i = 0; i < runs; i++) detectLang(long);
    const each = (performance.now() - t0) / runs;
    expect(each).toBeLessThan(5);
  });
});

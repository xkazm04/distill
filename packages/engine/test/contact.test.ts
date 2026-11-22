import { describe, expect, it } from "vitest";
import { findContacts, type FoundContact } from "../src/index.js";
import { parse } from "./helpers.js";

const find = (html: string, url = "https://www.autoservis-example.cz/") => {
  const els = new Map<string, Element>();
  const items = findContacts(parse(html), { url, onElement: (id, el) => els.set(id, el) });
  return { items, els };
};
const kinds = (items: FoundContact[]) => items.map((i) => i.kind);
const texts = (items: FoundContact[], kind: FoundContact["kind"]) => items.filter((i) => i.kind === kind).map((i) => i.text);

describe("findContacts", () => {
  it("reads a Czech small-business footer: phone, mobile, e-mail, address, hours and the contact page", () => {
    const { items, els } = find(`<!doctype html><html><body>
      <table><tr><td><a href="index.htm">Úvod</a> | <a href="sluzby.htm">Služby</a> | <a href="kontakt.htm">Kontakt</a></td></tr></table>
      <p>Provádíme opravy osobních vozidel všech značek. Ceny od 450 Kč za hodinu práce.</p>
      <font size="1" color="#999999">Autoservis Novák, Plzeňská 123/45, 330 11 Štáhlavy<br>
      tel.: 377 912 345, mobil: 602 123 456<br>
      e-mail: servis(at)novak-example.cz<br>
      IČO: 12345678, DIČ: CZ12345678, č. ú. 1234567890/0800<br>
      Otevírací doba: Po-Pá 7:30 - 16:30, So 8-12</font>
    </body></html>`);
    expect(kinds(items)).toEqual(["phone", "phone", "email", "address", "hours", "contactPage"]);
    expect(items.map((i) => i.id)).toEqual(["k0", "k1", "k2", "k3", "k4", "k5"]);
    expect(items[0]).toEqual({ id: "k0", kind: "phone", text: "377 912 345", href: "tel:+420377912345" });
    expect(items[1]).toMatchObject({ text: "602 123 456", href: "tel:+420602123456" });
    expect(items[2]).toEqual({ id: "k2", kind: "email", text: "servis@novak-example.cz", href: "mailto:servis@novak-example.cz" });
    expect(items[3]).toMatchObject({ text: "Plzeňská 123/45, 330 11 Štáhlavy" });
    expect(items[3]?.href).toBeUndefined();
    expect(items[4]).toMatchObject({ text: "Po-Pá 7:30 - 16:30, So 8-12" });
    expect(items[5]).toEqual({ id: "k5", kind: "contactPage", text: "Kontakt", href: "https://www.autoservis-example.cz/kontakt.htm" });
    // Every item knows where it was found; the phone in the small grey footer text.
    expect(els.get("k0")?.localName).toBe("font");
    expect(els.get("k5")?.getAttribute("href")).toBe("kontakt.htm");
  });

  it("never takes a date, a price, a company or tax id, a bank account, a postcode or opening hours for a phone", () => {
    const { items } = find(`<html><body>
      <p>Aktualizováno 21. 11. 2026, platí od 1.1.2025 do 31.12.2025.</p>
      <p>Cena: 1 290 000 Kč, akce 12 990,- Kč, 125 000 000 CZK</p>
      <p>IČO: 123 45 678 · DIČ: CZ699001234 · IČ DPH: SK2020123456</p>
      <p>Bankovní spojení: 19-2000145399/0800, účet 123456789/0100, IBAN CZ65 0800 0000 1920 0014 5399</p>
      <p>Úřední hodiny: Po, St 8.00 - 12.00 13.00 - 17.00</p>
      <p>Č. j.: 123 456 789 / Spisová značka 22/2026</p>
      <p>Sídlo: Náměstí 5, 330 11 Štáhlavy</p>
    </body></html>`);
    expect(texts(items, "phone")).toEqual([]);
    expect(texts(items, "address")).toEqual(["Náměstí 5, 330 11 Štáhlavy"]);
    expect(texts(items, "hours")).toEqual(["Po, St 8.00 - 12.00 13.00 - 17.00"]);
  });

  it("never reads a row of prices in a table as one phone number (seen on a live trailer rental site)", () => {
    const { items } = find(`<html><body><table>
      <tr><th>Přívěs</th><th>1 den</th><th>víkend</th><th>týden</th></tr>
      <tr><td>Bržděný</td><td>400</td><td>300</td><td>1000</td></tr>
      <tr><td>Skříňový</td><td>400</td><td>300</td><td>2000</td></tr>
    </table><p>Rezervace na tel. 602 106 000</p></body></html>`);
    expect(texts(items, "phone")).toEqual(["602 106 000"]);
  });

  it("takes tel: and mailto: links first and lists each number and address once", () => {
    const { items } = find(`<html><body>
      <header><a href="tel:+420377912345">Zavolejte nám</a> <a href="mailto:obec@obec-example.cz?subject=Dotaz">Napište nám</a></header>
      <footer>Telefon: +420 377 912 345 · E-mail: obec@obec-example.cz · Tel./fax: 00420 377 912 346</footer>
    </body></html>`);
    expect(items.filter((i) => i.kind === "phone").map((i) => [i.text, i.href])).toEqual([
      ["+420377912345", "tel:+420377912345"],
      ["00420 377 912 346", "tel:+420377912346"],
    ]);
    expect(texts(items, "email")).toEqual(["obec@obec-example.cz"]);
  });

  it("skips a fax line and reads two numbers written as one run", () => {
    const { items } = find(`<html><body><p>Fax: 377 912 399</p><p>Tel.: 377 912 345 / 777 123 456</p></body></html>`);
    expect(texts(items, "phone")).toEqual(["377 912 345", "777 123 456"]);
  });

  it("reads e-mail addresses written to fool robots", () => {
    const { items } = find(`<html><body>
      <p>Pište na info [zavináč] firma-example [tečka] cz nebo jana.novakova(at)firma-example.cz,</p>
      <p>případně starosta {at} obec-example.cz.</p>
    </body></html>`);
    expect(texts(items, "email")).toEqual(["info@firma-example.cz", "jana.novakova@firma-example.cz", "starosta@obec-example.cz"]);
  });

  it("reads an English page: US and UK numbers, an address element, the contact page", () => {
    const { items } = find(`<html lang="en"><body>
      <nav><a href="/">Home</a> <a href="/contact-us">Contact us</a></nav>
      <p>Questions? Call (555) 123-4567 or our London office on 020 7946 0018. Since 2004, 12,000 happy customers.</p>
      <address>Bike Works Ltd<br>14 Station Road<br>Cambridge CB1 2JB</address>
      <p>Opening hours: Mon-Fri 9-18, Sat 10-14</p>
    </body></html>`, "https://bikeworks.example/about");
    expect(texts(items, "phone")).toEqual(["(555) 123-4567", "020 7946 0018"]);
    expect(texts(items, "address")).toEqual(["14 Station Road, Cambridge CB1 2JB"]);
    expect(texts(items, "hours")).toEqual(["Mon-Fri 9-18, Sat 10-14"]);
    expect(items.find((i) => i.kind === "contactPage")?.href).toBe("https://bikeworks.example/contact-us");
  });

  it("reads a German Impressum line and its hours", () => {
    const { items } = find(`<html lang="de"><body>
      <p>Fahrradwerkstatt Müller, Hauptstraße 12a, 10115 Berlin</p>
      <p>Telefon: +49 30 1234567 · Handy: 0171 2345678 · USt-IdNr.: DE123456789</p>
      <p>Öffnungszeiten: Mo-Fr 9-18 Uhr</p>
      <a href="/impressum">Impressum</a>
    </body></html>`, "https://rad-example.de/");
    expect(texts(items, "phone")).toEqual(["+49 30 1234567", "0171 2345678"]);
    expect(items[0]?.href).toBe("tel:+49301234567");
    expect(items[1]?.href).toBe("tel:01712345678");
    expect(texts(items, "address")).toEqual(["Hauptstraße 12a, 10115 Berlin"]);
    expect(texts(items, "hours")).toEqual(["Mo-Fr 9-18 Uhr"]);
    expect(texts(items, "contactPage")).toEqual(["Impressum"]);
  });

  it("reads schema.org microdata and JSON-LD", () => {
    const { items } = find(`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair",
      "telephone":"+420 377 912 345","email":"servis@example.cz","openingHours":["Mo-Fr 07:00-16:00","Sa 08:00-11:00"]}</script></head><body>
      <div itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">Plzeňská 7</span>,
      <span itemprop="postalCode">332 03</span> <span itemprop="addressLocality">Štáhlavy</span></div>
    </body></html>`);
    expect(texts(items, "phone")).toEqual(["+420 377 912 345"]);
    expect(texts(items, "email")).toEqual(["servis@example.cz"]);
    expect(texts(items, "address")[0]).toBe("Plzeňská 7, 332 03 Štáhlavy");
    expect(texts(items, "hours")).toEqual(["Mo-Fr 07:00-16:00; Sa 08:00-11:00"]);
  });

  it("joins hours written over several lines (a table, stacked headings) into one item", () => {
    const { items } = find(`<html><body>
      <h1>Otevírací doba</h1>
      <table><tr><td>Pondělí:</td><td>8:00 - 16:00</td></tr><tr><td>Úterý:</td><td>8:00 - 16:00</td></tr>
      <tr><td>Středa:</td><td>8:00 - 17:00</td></tr></table>
      <p>Půjčovna přívěsů a vozíků.</p>
    </body></html>`);
    expect(texts(items, "hours")).toEqual(["Pondělí: 8:00 - 16:00; Úterý: 8:00 - 16:00; Středa: 8:00 - 17:00"]);
  });

  it("dials a Czech page's 9-digit number with +420, even with no lang attribute and no .cz address", () => {
    const czech = `<html><body><p>Na opravu se můžete objednat telefonicky na čísle 377 912 345 nebo osobně v dílně, kde vám
      rádi poradíme. Drobné opravy děláme zpravidla ještě týž den.</p></body></html>`;
    expect(find(czech, "http://127.0.0.1:8080/servis.html").items[0]?.href).toBe("tel:+420377912345");
    const english = `<html><body><p>Call our workshop on 377 912 345 and we will be happy to help you with the repair of your bike.</p></body></html>`;
    expect(find(english, "http://127.0.0.1:8080/servis.html").items[0]?.href).toBe("tel:377912345");
  });

  it("gives no contact page when the page is the contact page", () => {
    const { items } = find(`<html><body><h1>Kontakt</h1><a href="/kontakty">Kontakty</a><p>Tel.: 377 912 345</p></body></html>`,
      "https://www.obec-example.cz/kontakt");
    expect(kinds(items)).toEqual(["phone"]);
  });

  it("never reads what is in a form field or an editable area", () => {
    const { items } = find(`<html><body><form>
      <input name="tel" value="777 123 456"><textarea>Volejte 602 123 456, pisu na ja@example.cz</textarea>
      <div contenteditable="true">733 111 222</div></form></body></html>`);
    expect(items).toEqual([]);
  });

  it("keeps at most eight items, phones and e-mails first", () => {
    const phones = Array.from({ length: 6 }, (_, i) => `<p>Tel.: 377 912 34${i}</p>`).join("");
    const mails = Array.from({ length: 6 }, (_, i) => `<p>mail${i}@example.cz</p>`).join("");
    const { items } = find(`<html><body><p>Hlavní 5, 330 11 Štáhlavy</p><p>Po-Pá 8-17</p><a href="/kontakt">Kontakt</a>${phones}${mails}</body></html>`);
    expect(items).toHaveLength(8);
    expect(kinds(items)).toEqual(["phone", "phone", "phone", "email", "email", "email", "address", "hours"]);
  });

  // Round-1 gap G6: an address with no postcode, or with it on a line of its own after the town.
  it("reads the trailer rental's address: street, town, then the postcode alone (Půjčovna Šmíd, live 2026-11-22)", () => {
    const { items, els } = find(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><title>pujcovnasmid</title></head>
      <body background="pozadi.png"><center><img src="z9o.png" width="30%" height="150">
      <div style="margin-left: 15%; margin-right: 15%; background-color: #FFFFCC; border: 3px solid blue">
      <h3>
      Michal Šmíd <br>
      Rovná 235 <br>
      Jablonec nad Nisou - Kokonín<br>
      468 01 <br>
      <a href="http://www.pujcovnasmid.cz/mapka.html">Mapa</a></h3>
      <div style="width:130px;height:130px;" id="overena-firma"><a href="http://www.idatabaze.cz/firma/203784/" target="_blank"><img src="stamp.png" alt="idatabaze.cz"></a></div>
      <img src="zf.jpg" width="150" height="150" border="1"><hr>
      <h3> Provozní doba : </h3>
      <h3> Objednávky přijímáme <u>v níže uvedených časech, </u> nejlépe 24 hodin předem</h3>
      <h1> Telefon : 602 106 673</h1>
      <h1>Pondělí-Pátek 9-18 hodin</h1>
      <h1>Sobota 9-12 hodin</h1>
      <h1>Neděle 10-12 hodin</h1>
      <table border="2"><tr><th>Typ</th><th>Délka m</th><th>Šířka m</th><th>Nosnost Kg</th><th>Cena s daní za 1 den Kč</th><th>Kauce</th>
      <tr><th><img src="2mplech.png"></th><th>2</th><th>1.2</th><th>400</th><th>300</th><th>1000</th>
      <tr><th><img src="3mp.png"></th><th>3</th><th>1.34</th><th>480</th><th>350</th><th>2000</th></table>
      <h1><marquee height="40" bgcolor="red">Počet vleků i typů stále rozšiřujeme !!!  Od 7/2015 máme další 3 nové typy vleků</marquee></h1>
      </div></center></body></html>`, "http://www.pujcovnasmid.cz/");
    expect(kinds(items)).toEqual(["phone", "address", "hours"]);
    expect(texts(items, "address")).toEqual(["Rovná 235, 468 01 Jablonec nad Nisou - Kokonín"]);
    expect(els.get(items[1]?.id ?? "")?.localName).toBe("h3");
  });

  it("reads a Czech address with no postcode when the page says it is one: a label, a heading, or a phone beside it", () => {
    const { items } = find(`<html lang="cs"><body>
      <p>Adresa: Na Výsluní 1234/5, Liberec</p>
      <h2>Kde nás najdete</h2><p>Hostinec Na Návsi<br>Kokory č.p. 23<br>Kokory</p>
      <div class="kontakt"><p>U Lípy 12a</p><p>Praha 4 - Nusle</p><p>tel. 777 123 456</p></div>
    </body></html>`);
    expect(texts(items, "phone")).toEqual(["777 123 456"]);
    // Two at most, in page order.
    expect(texts(items, "address")).toEqual(["Na Výsluní 1234/5, Liberec", "Kokory č.p. 23, Kokory"]);
    const third = find(`<html lang="cs"><body><div class="kontakt"><p>U Lípy 12a</p><p>Praha 4 - Nusle</p><p>tel. 777 123 456</p></div></body></html>`);
    expect(texts(third.items, "address")).toEqual(["U Lípy 12a, Praha 4 - Nusle"]);
    const square = find(`<html lang="cs"><body><p>Sídlo: Pekařství Novák, nám. Míru 7, Turnov</p></body></html>`);
    expect(texts(square.items, "address")).toEqual(["nám. Míru 7, Turnov"]);
  });

  it("reads a German and an English address with no postcode", () => {
    const de = find(`<html lang="de"><body><p>Anschrift: Hauptstraße 12a, Görlitz</p></body></html>`, "https://rad-example.de/");
    expect(texts(de.items, "address")).toEqual(["Hauptstraße 12a, Görlitz"]);
    const en = find(`<html lang="en"><body><div><p>Bike Works Ltd</p><p>14 Station Road</p><p>Bristol</p><p>Call 0117 496 0123</p></div></body></html>`, "https://bikeworks.example/");
    expect(texts(en.items, "address")).toEqual(["14 Station Road, Bristol"]);
  });

  it("never takes an address without a postcode that nothing vouches for", () => {
    const { items } = find(`<html lang="cs"><body><div><p>Rovná 235</p><p>Jablonec nad Nisou</p></div></body></html>`);
    expect(texts(items, "address")).toEqual([]);
  });

  // The traps sit next to a phone, so only what they are decides.
  const besidePhone = (html: string) => texts(find(`<html lang="cs"><body><div class="box">${html}<p>Telefon: 602 106 673</p></div></body></html>`).items, "address");

  it("never takes running text for an address without a postcode", () => {
    expect(besidePhone(`<p>Přívěsy vydáváme na adrese Rovná 235 v Jablonci nad Nisou.</p>`)).toEqual([]);
    expect(besidePhone(`<p>Jsme tu pro vás 25</p><p>Liberec</p>`)).toEqual([]);
    expect(besidePhone(`<p>Novinka 2025</p><p>Liberec</p>`)).toEqual([]);
  });

  it("never takes a date or opening hours for an address without a postcode", () => {
    expect(besidePhone(`<p>Září 2024</p><p>Liberec</p>`)).toEqual([]);
    expect(besidePhone(`<p>Od 7/2015</p><p>Nové typy vleků</p>`)).toEqual([]);
    expect(besidePhone(`<p>Sobota 9</p><p>Neděle 10</p>`)).toEqual([]);
    expect(besidePhone(`<p>Aktualizováno 12. 3. 2024</p><p>Liberec</p>`)).toEqual([]);
  });

  it("never takes a price list's row or a product code for an address without a postcode", () => {
    expect(besidePhone(`<ul><li>Vlek Agados 750</li><li>Liberec - Vratislavice</li><li>Cena 350 Kč/den</li></ul>`)).toEqual([]);
    expect(besidePhone(`<table><tr><td>Přívěs 750</td><td>300 Kč</td></tr><tr><td>Liberec</td><td>350 Kč</td></tr></table>`)).toEqual([]);
    expect(besidePhone(`<p>Thule Motion XT 800</p><p>Jablonec nad Nisou</p>`)).toEqual([]);
    expect(besidePhone(`<p>Kauce 3000</p><p>Nosnost 480</p>`)).toEqual([]);
  });

  it("finds nothing on a page with no contact details", () => {
    const { items } = find(`<html><body><h1>Bramboráky</h1><p>Na 4 porce: 1 kg brambor, 2 vejce, 3 lžíce mouky, 2 stroužky česneku.
      Smažte 3 až 4 minuty z každé strany při 180 °C. Recept z roku 2019, upraveno 12. 3. 2024.</p></body></html>`);
    expect(items).toEqual([]);
  });
});

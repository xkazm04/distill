import { describe, expect, it } from "vitest";
import { describeLink, readableHost, registrableDomain } from "../src/links.js";

const PAGE = "https://www.praslavice.cz/obecni-urad/poplatky?rok=2026";

describe("describeLink: the kind", () => {
  it.each([
    ["mailto:podatelna@praslavice.cz", "mail"],
    ["MAILTO:starosta@stahlavy.cz?subject=Dotaz", "mail"],
    ["tel:+420585150218", "phone"],
    ["callto:+420602106673", "phone"],
    ["sms:+420602106673", "phone"],
    ["javascript:void(0)", "script"],
    ["JavaScript:window.print()", "script"],
    ["#poplatky", "anchor"],
    ["", "anchor"],
    ["https://www.praslavice.cz/obecni-urad/poplatky?rok=2026#odpady", "anchor"],
    ["ftp://ftp.example.cz/file.zip", "other"],
    ["data:text/plain,ahoj", "other"],
  ] as const)("%s -> %s", (href, kind) => {
    const n = describeLink(href, PAGE);
    expect(n.kind).toBe(kind);
    expect(n.site).toBe("");
    expect(n.leaves).toBe(false);
  });

  it("another page of the same site with a fragment is a web link, not an anchor", () => {
    expect(describeLink("/obecni-urad/kontakty#starosta", PAGE).kind).toBe("web");
    expect(describeLink("?rok=2025#odpady", PAGE).kind).toBe("web");
  });
});

describe("describeLink: the site and leaving it", () => {
  it("a relative link stays on the site", () => {
    expect(describeLink("/dokumenty/vyhlaska.html", PAGE)).toEqual({ site: "praslavice.cz", leaves: false, tracking: [], kind: "web" });
  });
  it("a subdomain of the same site does not leave it", () => {
    const n = describeLink("https://mapy.praslavice.cz/", PAGE);
    expect(n).toMatchObject({ site: "mapy.praslavice.cz", leaves: false });
  });
  it("another site leaves", () => {
    expect(describeLink("https://www.mojedane.cz/", PAGE)).toMatchObject({ site: "mojedane.cz", leaves: true });
    expect(describeLink("http://www.idatabaze.cz/firma/203784-smid-michal/", "http://www.pujcovnasmid.cz/")).toMatchObject({ site: "idatabaze.cz", leaves: true });
  });
  it("http and https of the same site are one site", () => {
    expect(describeLink("http://www.praslavice.cz/", PAGE).leaves).toBe(false);
  });
  it("two-part suffixes: bbc.co.uk and gov.uk are owners, not co.uk", () => {
    expect(describeLink("https://www.bbc.co.uk/news", "https://news.bbc.co.uk/x").leaves).toBe(false);
    expect(describeLink("https://www.gov.uk/", "https://www.bbc.co.uk/").leaves).toBe(true);
    expect(registrableDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("www.abc.net.au")).toBe("abc.net.au");
  });
  it("shared hosts: two webnode or github.io sites are different owners", () => {
    expect(describeLink("https://hasici-praslavice.webnode.cz/", "https://sokol-praslavice.webnode.cz/").leaves).toBe(true);
    expect(describeLink("https://a.github.io/x", "https://a.github.io/y").leaves).toBe(false);
    expect(registrableDomain("hasici.webnode.cz")).toBe("hasici.webnode.cz");
  });
  it("Czech sites keep their registrable name", () => {
    expect(registrableDomain("www.denik.cz")).toBe("denik.cz");
    expect(registrableDomain("zpravy.aktualne.cz")).toBe("aktualne.cz");
    expect(registrableDomain("portal.gov.cz")).toBe("gov.cz");
    expect(describeLink("https://portal.gov.cz/sluzby-vs/", "https://www.mvcr.cz/").leaves).toBe(true);
    expect(describeLink("https://www.idnes.cz/zpravy", "https://zpravy.idnes.cz/").leaves).toBe(false);
  });
  it("addresses by IP and localhost compare whole", () => {
    expect(describeLink("http://127.0.0.1:5173/a", "http://127.0.0.1:5173/b").leaves).toBe(false);
    expect(describeLink("http://192.168.1.1/", "http://127.0.0.1/").leaves).toBe(true);
    expect(describeLink("http://localhost:3000/a", "http://localhost:3000/").site).toBe("localhost");
  });
  it("an IDN reads as written", () => {
    expect(readableHost("www.xn--hrady-zmky-y4a.cz")).toBe("hrady-zámky.cz");
    expect(describeLink("https://www.xn--obec-pslavice-8db31p.cz/", PAGE).site).toBe("obec-přáslavice.cz");
    expect(readableHost("xn--bcher-kva.example")).toBe("bücher.example");
  });
});

describe("describeLink: redirectors", () => {
  it("google.com/url?q= is unwrapped to its target", () => {
    const n = describeLink("https://www.google.com/url?sa=t&rct=j&q=&esrc=s&url=https%3A%2F%2Fwww.mvcr.cz%2Fclanek%2Fobcanske-prukazy.aspx&usg=AOvVaw", PAGE);
    expect(n).toMatchObject({ site: "mvcr.cz", leaves: true, unwrapped: "https://www.mvcr.cz/clanek/obcanske-prukazy.aspx", clean: "https://www.mvcr.cz/clanek/obcanske-prukazy.aspx" });
  });
  it("google.cz/url?q= with an empty url param uses q", () => {
    const n = describeLink("https://www.google.cz/url?q=https://www.praslavice.cz/odpady.pdf&sa=U&ved=2ah", "https://www.seznam.cz/");
    expect(n).toMatchObject({ site: "praslavice.cz", fileType: "PDF", unwrapped: "https://www.praslavice.cz/odpady.pdf" });
  });
  it("a google redirect back to the page's own site does not leave it", () => {
    expect(describeLink("/url?q=https://www.praslavice.cz/kontakty", "https://www.google.com/search?q=praslavice").leaves).toBe(true);
    expect(describeLink("https://www.google.com/url?q=https://www.praslavice.cz/kontakty", PAGE).leaves).toBe(false);
  });
  it("l.facebook.com/l.php?u= is unwrapped, and the target's own fbclid goes", () => {
    const n = describeLink("https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.denik.cz%2Fekonomika%2Fprispevek%2F%3Ffbclid%3DIwAR0abc&h=AT0", PAGE);
    expect(n).toMatchObject({ site: "denik.cz", unwrapped: "https://www.denik.cz/ekonomika/prispevek/?fbclid=IwAR0abc", clean: "https://www.denik.cz/ekonomika/prispevek/", tracking: ["fbclid"] });
  });
  it("out.reddit.com, youtube.com/redirect, Outlook safe links", () => {
    expect(describeLink("https://out.reddit.com/t3_abc?url=https%3A%2F%2Fexample.org%2Fa&token=x", PAGE).unwrapped).toBe("https://example.org/a");
    expect(describeLink("https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fwww.kubicek.cz%2Frecept&v=Wlg", PAGE).site).toBe("kubicek.cz");
    expect(describeLink("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.stahlavy.cz%2F&data=05", PAGE).site).toBe("stahlavy.cz");
  });
  it("a redirect inside a redirect is unwrapped twice", () => {
    const inner = encodeURIComponent("https://l.facebook.com/l.php?u=" + encodeURIComponent("https://www.stahlavy.cz/"));
    expect(describeLink(`https://www.google.com/url?q=${inner}`, PAGE).site).toBe("stahlavy.cz");
  });
  it("a redirector whose target is not a web address stays as it is", () => {
    const n = describeLink("https://www.google.com/url?q=javascript:alert(1)", PAGE);
    expect(n).toMatchObject({ site: "google.com", leaves: true });
    expect(n.unwrapped).toBeUndefined();
  });
  it("a google page that is not /url is not a redirect", () => {
    expect(describeLink("https://www.google.com/maps?q=Pr%C3%A1slavice", PAGE)).toMatchObject({ site: "google.com" });
    expect(describeLink("https://www.google.com/maps?q=Pr%C3%A1slavice", PAGE).unwrapped).toBeUndefined();
  });
  it("shorteners hide their target: only their own site", () => {
    expect(describeLink("https://t.co/AbCdEf123", PAGE)).toEqual({ site: "t.co", leaves: true, tracking: [], kind: "web" });
    expect(describeLink("https://bit.ly/3xyz", PAGE)).toEqual({ site: "bit.ly", leaves: true, tracking: [], kind: "web" });
  });
});

describe("describeLink: file types", () => {
  it.each([
    ["/dokumenty/vyhlaska-o-odpadech.pdf", "PDF"],
    ["/files/Zadost_o_vydani.DOCX", "DOCX"],
    ["/files/zadost.doc", "DOC"],
    ["/files/rozpocet-2026.xlsx", "XLSX"],
    ["/files/rozpocet.xls", "XLS"],
    ["/files/formular.odt", "ODT"],
    ["/files/archiv.zip", "ZIP"],
    ["/files/archiv.rar", "RAR"],
    ["/foto/naves.JPG", "JPG"],
    ["/foto/plan.png", "PNG"],
    ["/audio/hlaseni.mp3", "MP3"],
    ["/video/den-obce.mp4", "MP4"],
    ["/download/setup.exe", "EXE"],
    ["/download/installer.msi", "MSI"],
    ["/upload/Vyhl%C3%A1%C5%A1ka%20%C4%8D.%201.pdf?v=3", "PDF"],
  ])("%s -> %s", (path, type) => {
    expect(describeLink(path, PAGE).fileType).toBe(type);
  });
  it("a page or a folder has no file type", () => {
    expect(describeLink("/obecni-urad/", PAGE).fileType).toBeUndefined();
    expect(describeLink("/clanek.aspx?id=5", PAGE).fileType).toBeUndefined();
    expect(describeLink("/index.html", PAGE).fileType).toBeUndefined();
    expect(describeLink("https://www.praslavice.cz", PAGE).fileType).toBeUndefined();
  });
});

describe("describeLink: tracking tags", () => {
  it("utm_* tags go, the rest of the address stays as written", () => {
    const n = describeLink("https://www.mojedane.cz/clanek?id=12&utm_source=newsletter&utm_medium=email&utm_campaign=dane%202026#postup", PAGE);
    expect(n.tracking).toEqual(["utm_source", "utm_medium", "utm_campaign"]);
    expect(n.clean).toBe("https://www.mojedane.cz/clanek?id=12#postup");
  });
  it.each(["fbclid", "gclid", "dclid", "msclkid", "mc_eid", "yclid", "_hsenc", "igshid", "sznclid", "gbraid", "twclid"])("%s goes", (tag) => {
    const n = describeLink(`https://www.example.cz/a?${tag}=XYZ123`, PAGE);
    expect(n.tracking).toEqual([tag]);
    expect(n.clean).toBe("https://www.example.cz/a");
  });
  it("si goes from YouTube and Spotify share links only", () => {
    expect(describeLink("https://youtu.be/19TP5GMGgPU?si=AbC123", PAGE).clean).toBe("https://youtu.be/19TP5GMGgPU");
    expect(describeLink("https://www.youtube.com/watch?v=19TP5GMGgPU&si=AbC123&t=42", PAGE).clean).toBe("https://www.youtube.com/watch?v=19TP5GMGgPU&t=42");
    expect(describeLink("https://www.example.cz/?si=5", PAGE).clean).toBeUndefined();
  });
  it("an ordinary query is never touched", () => {
    const n = describeLink("https://www.example.cz/hledat?q=odpady&strana=2&ref=menu", PAGE);
    expect(n.tracking).toEqual([]);
    expect(n.clean).toBeUndefined();
  });
  it("keeps the encoding of the other parameters", () => {
    expect(describeLink("https://e.cz/s?q=a+b%20c&utm_term=x", PAGE).clean).toBe("https://e.cz/s?q=a+b%20c");
  });
  it("a link of the same site with tracking tags is still cleaned", () => {
    expect(describeLink("/akce?utm_source=fb", PAGE)).toMatchObject({ leaves: false, clean: "https://www.praslavice.cz/akce", tracking: ["utm_source"] });
  });
});

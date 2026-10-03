"""Automatikus fő attribútum (és opcionálisan egy al-attribútum) hozzárendelés
a közlemény (description) tartalma alapján. Case-insensitive részszó-egyezés.

Csak KIADÁS (negatív összegű) rekordokra alkalmazzuk (lásd main.py).
Az első illeszkedő szabály nyer, ezért a sorrend számít, ha átfedés lenne.
"""

# (kulcsszavak, fő attribútum, al-attribútum vagy None)
RULES: list[tuple[list[str], str, str | None]] = [
    (["mol move"], "parkolás", None),
    (["misi fakanala", "csepel grill"], "ebéd", None),
    (["parkolo", "parkoló", "pm-abacus"], "parkolás", None),
    (["obi hungary"], "Barkácsbolt", None),
    (
        [
            "mcd",
            "cserped tejivo",
            "cserpeд tejivo",
            "wok 'n go",
            "wok n go",
            "mevlana",
            "kemenes",
            "trattoria",
            "best stuff",
            "mesopotami",
            "somfa",
        ],
        "gyorskaja",
        None,
    ),
    (
        ["spar", "lidl", "prima pek", "auchan", "aldi", "ecofamily", "budapest bakery", "allegro"],
        "bevásárlás",
        None,
    ),
    (["kedvenc rendelo", "kedvenc rendelő", "fressnapf"], "kutya", None),
    (["youtube premium", "sion security"], "rezsi", None),
    (["parag rober", "parag róber", "parag róbert"], "fodrász", None),
    (["magyar allamkincstar", "magyar államkincstár"], "gyerekek", "babakötvény"),
    (
        [
            "mvm next",
            "fovarosi vizmuve",
            "fővárosi vízműve",
            "fővárosi vízmüve",
            "magyar telekom",
        ],
        "rezsi",
        None,
    ),
    (["lionswashkeres", "omv"], "autó", None),
    (["szerencsejatek", "szerencsejáték", "lottozo", "lottózó", "smplay magenta"], "egyéb", None),
    (["sportsdirect", "heavy tools"], "ruha", None),
    (["glshungary", "gls hungary"], "GLS/futár", None),
    (["budapestgo"], "egyéb", "tömegközlekedés"),
    (["atm", "ujbuda gamesz", "újbuda gamesz"], "gyerekek", None),
    (["gepjarmu hitel", "gépjármü hitel", "gépjármű hitel"], "autóhitel", None),
]


def auto_categorize(description: str | None) -> tuple[str | None, str | None]:
    if not description:
        return None, None
    desc_lower = description.lower()
    for keywords, main_cat, sub_cat in RULES:
        for kw in keywords:
            if kw.lower() in desc_lower:
                return main_cat, sub_cat
    return None, None

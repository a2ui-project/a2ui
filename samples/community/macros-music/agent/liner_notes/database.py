# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A small in-memory music database for the demo.

Biographical facts are summarized from public sources. Track durations are
approximate, and every tour date is fictional demo data.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Literal

TicketStatus = Literal["onSale", "fewLeft", "soldOut"]


@dataclasses.dataclass(frozen=True)
class Track:
    title: str
    duration: str


@dataclasses.dataclass(frozen=True)
class Album:
    id: str
    title: str
    year: int
    label: str
    kind: str = "Studio album"
    note: str = ""
    tracks: tuple[Track, ...] = ()


@dataclasses.dataclass(frozen=True)
class TourDate:
    date: str
    city: str
    country: str
    venue: str
    status: TicketStatus


@dataclasses.dataclass(frozen=True)
class CareerEvent:
    year: int
    title: str
    detail: str = ""


@dataclasses.dataclass(frozen=True)
class Artist:
    id: str
    name: str
    kind: str
    origin: str
    region: str
    active: str
    genres: tuple[str, ...]
    hue: int
    bio: str
    facts: tuple[str, ...]
    timeline: tuple[CareerEvent, ...]
    albums: tuple[Album, ...]
    tour: tuple[TourDate, ...] = ()

    @property
    def debut_year(self) -> int:
        return min(album.year for album in self.albums)

    def summary(self) -> dict[str, Any]:
        """Compact description used in the system prompt and search results."""
        return {
            "artistId": self.id,
            "name": self.name,
            "origin": self.origin,
            "region": self.region,
            "active": self.active,
            "genres": list(self.genres),
            "touring": bool(self.tour),
        }

    def to_json(self) -> dict[str, Any]:
        """Full record returned by the `get_artist_facts` tool."""
        return {
            **self.summary(),
            "kind": self.kind,
            "bio": self.bio,
            "facts": list(self.facts),
            "timeline": [dataclasses.asdict(e) for e in self.timeline],
            "albums": [
                {
                    "albumId": a.id,
                    "title": a.title,
                    "year": a.year,
                    "label": a.label,
                    "kind": a.kind,
                    "note": a.note,
                    "hasTracklist": bool(a.tracks),
                }
                for a in self.albums
            ],
            "tour": [dataclasses.asdict(t) for t in self.tour],
        }


def _tracks(*items: tuple[str, str]) -> tuple[Track, ...]:
    return tuple(Track(title, duration) for title, duration in items)


ARTISTS: tuple[Artist, ...] = (
    Artist(
        id="the-beatles",
        name="The Beatles",
        kind="Band",
        origin="Liverpool, England",
        region="Europe",
        active="1960–1970",
        genres=("Rock", "Pop", "Psychedelia"),
        hue=210,
        bio=(
            "John Lennon, Paul McCartney, George Harrison and Ringo Starr turned"
            " Merseybeat into the most influential catalogue in pop, moving from"
            " two-minute love songs to studio experiments in under a decade."
        ),
        facts=(
            (
                "The Abbey Road cover was shot on 8 August 1969 on the zebra crossing"
                " outside EMI Studios in London."
            ),
            (
                "Their last public performance was the rooftop concert on the Apple"
                " Corps building on 30 January 1969."
            ),
            (
                "An estimated 73 million Americans watched their first Ed Sullivan Show"
                " appearance in February 1964."
            ),
        ),
        timeline=(
            CareerEvent(
                1960, "The Beatles name is adopted", "Residencies in Hamburg follow."
            ),
            CareerEvent(
                1962, "Ringo Starr joins", "First single 'Love Me Do' is released."
            ),
            CareerEvent(1964, "The Ed Sullivan Show", "Beatlemania reaches the US."),
            CareerEvent(
                1966, "Touring stops", "The final concert is at Candlestick Park."
            ),
            CareerEvent(1967, "Sgt. Pepper's Lonely Hearts Club Band"),
            CareerEvent(1969, "Rooftop concert and Abbey Road"),
            CareerEvent(1970, "The band breaks up", "Let It Be is released in May."),
        ),
        albums=(
            Album("please-please-me", "Please Please Me", 1963, "Parlophone"),
            Album("with-the-beatles", "With the Beatles", 1963, "Parlophone"),
            Album("a-hard-days-night", "A Hard Day's Night", 1964, "Parlophone"),
            Album("beatles-for-sale", "Beatles for Sale", 1964, "Parlophone"),
            Album("help", "Help!", 1965, "Parlophone"),
            Album("rubber-soul", "Rubber Soul", 1965, "Parlophone"),
            Album(
                "revolver",
                "Revolver",
                1966,
                "Parlophone",
                note="Tape loops, reversed guitars and Indian classical influences.",
                tracks=_tracks(
                    ("Taxman", "2:39"),
                    ("Eleanor Rigby", "2:07"),
                    ("I'm Only Sleeping", "3:01"),
                    ("Love You To", "3:01"),
                    ("Here, There and Everywhere", "2:25"),
                    ("Yellow Submarine", "2:40"),
                    ("She Said She Said", "2:37"),
                    ("Good Day Sunshine", "2:09"),
                    ("And Your Bird Can Sing", "2:01"),
                    ("For No One", "2:01"),
                    ("Doctor Robert", "2:15"),
                    ("I Want to Tell You", "2:29"),
                    ("Got to Get You into My Life", "2:30"),
                    ("Tomorrow Never Knows", "2:57"),
                ),
            ),
            Album(
                "sgt-pepper",
                "Sgt. Pepper's Lonely Hearts Club Band",
                1967,
                "Parlophone",
            ),
            Album("magical-mystery-tour", "Magical Mystery Tour", 1967, "Capitol"),
            Album("white-album", "The Beatles (White Album)", 1968, "Apple"),
            Album(
                "yellow-submarine", "Yellow Submarine", 1969, "Apple", kind="Soundtrack"
            ),
            Album(
                "abbey-road",
                "Abbey Road",
                1969,
                "Apple",
                note=(
                    "The last album the four recorded together, closing with the"
                    " side-two medley."
                ),
                tracks=_tracks(
                    ("Come Together", "4:20"),
                    ("Something", "3:03"),
                    ("Maxwell's Silver Hammer", "3:27"),
                    ("Oh! Darling", "3:26"),
                    ("Octopus's Garden", "2:51"),
                    ("I Want You (She's So Heavy)", "7:47"),
                    ("Here Comes the Sun", "3:05"),
                    ("Because", "2:45"),
                    ("You Never Give Me Your Money", "4:02"),
                    ("Sun King", "2:26"),
                    ("Mean Mr. Mustard", "1:06"),
                    ("Polythene Pam", "1:12"),
                    ("She Came In Through the Bathroom Window", "1:57"),
                    ("Golden Slumbers", "1:31"),
                    ("Carry That Weight", "1:36"),
                    ("The End", "2:19"),
                    ("Her Majesty", "0:23"),
                ),
            ),
            Album("let-it-be", "Let It Be", 1970, "Apple"),
        ),
    ),
    Artist(
        id="aldous-harding",
        name="Aldous Harding",
        kind="Solo artist",
        origin="Lyttelton, Aotearoa New Zealand",
        region="Oceania",
        active="2014–present",
        genres=("Art folk", "Indie folk", "Chamber pop"),
        hue=330,
        bio=(
            "Hannah Topp, who performs as Aldous Harding, writes elliptical,"
            " theatrical folk songs. Her albums on 4AD with producer John Parish"
            " made her one of New Zealand's most distinctive exports."
        ),
        facts=(
            (
                "Party and Designer were produced by John Parish, known for his work"
                " with PJ Harvey."
            ),
            "Her mother is the New Zealand folk singer Lorina Harding.",
            (
                "Her live shows are known for shifting facial expressions and"
                " theatrical stillness."
            ),
        ),
        timeline=(
            CareerEvent(2014, "Self-titled debut", "Released on Lyttelton Records."),
            CareerEvent(2017, "Party", "Her first album for 4AD."),
            CareerEvent(2019, "Designer", "Her widest breakthrough to date."),
            CareerEvent(2022, "Warm Chris"),
        ),
        albums=(
            Album("aldous-harding", "Aldous Harding", 2014, "Lyttelton Records"),
            Album("party", "Party", 2017, "4AD"),
            Album(
                "designer",
                "Designer",
                2019,
                "4AD",
                note="Recorded in Wales with John Parish.",
                tracks=_tracks(
                    ("Fixture Picture", "3:55"),
                    ("Designer", "4:03"),
                    ("Zoo Eyes", "4:11"),
                    ("Treasure", "3:39"),
                    ("The Barrel", "3:52"),
                    ("Damn", "4:21"),
                    ("Weight of the Planets", "3:57"),
                    ("Heaven Is Empty", "3:38"),
                    ("Pilot", "6:26"),
                ),
            ),
            Album("warm-chris", "Warm Chris", 2022, "4AD"),
        ),
        tour=(
            TourDate(
                "2026-12-04", "Auckland", "New Zealand", "Auckland Town Hall", "onSale"
            ),
            TourDate(
                "2026-12-06", "Wellington", "New Zealand", "The Opera House", "soldOut"
            ),
            TourDate(
                "2026-12-08",
                "Christchurch",
                "New Zealand",
                "Isaac Theatre Royal",
                "onSale",
            ),
            TourDate("2027-02-14", "Melbourne", "Australia", "Hamer Hall", "fewLeft"),
            TourDate(
                "2027-02-17", "Sydney", "Australia", "City Recital Hall", "onSale"
            ),
            TourDate("2027-03-20", "London", "UK", "Barbican Hall", "onSale"),
        ),
    ),
    Artist(
        id="nina-simone",
        name="Nina Simone",
        kind="Solo artist",
        origin="Tryon, North Carolina, USA",
        region="North America",
        active="1954–2003",
        genres=("Jazz", "Soul", "Blues", "Gospel"),
        hue=28,
        bio=(
            "Born Eunice Waymon, Nina Simone trained as a classical pianist and"
            " became the 'High Priestess of Soul', fusing jazz, blues and gospel"
            " with fierce civil rights songwriting."
        ),
        facts=(
            (
                "She hoped to become a concert pianist, but the Curtis Institute of"
                " Music rejected her; it gave her an honorary degree days before her"
                " death in 2003."
            ),
            (
                "'Mississippi Goddam' (1964) was her response to the murder of Medgar"
                " Evers and the Birmingham church bombing."
            ),
            "Her 1958 recording of 'I Loves You, Porgy' was her only US top-20 hit.",
        ),
        timeline=(
            CareerEvent(1954, "Becomes 'Nina Simone'", "Plays bars in Atlantic City."),
            CareerEvent(
                1959, "Little Girl Blue", "'I Loves You, Porgy' becomes a hit."
            ),
            CareerEvent(1964, "Mississippi Goddam"),
            CareerEvent(1965, "I Put a Spell on You", "Includes 'Feeling Good'."),
            CareerEvent(1993, "A Single Woman", "Her final studio album."),
            CareerEvent(2018, "Rock and Roll Hall of Fame"),
        ),
        albums=(
            Album("little-girl-blue", "Little Girl Blue", 1959, "Bethlehem"),
            Album(
                "nina-at-town-hall",
                "Nina Simone at Town Hall",
                1959,
                "Colpix",
                kind="Live album",
            ),
            Album("i-put-a-spell-on-you", "I Put a Spell on You", 1965, "Philips"),
            Album("pastel-blues", "Pastel Blues", 1965, "Philips"),
            Album("wild-is-the-wind", "Wild Is the Wind", 1966, "Philips"),
            Album(
                "nina-sings-the-blues",
                "Nina Simone Sings the Blues",
                1967,
                "RCA Victor",
            ),
            Album("to-love-somebody", "To Love Somebody", 1969, "RCA Victor"),
        ),
    ),
    Artist(
        id="fela-kuti",
        name="Fela Kuti",
        kind="Bandleader",
        origin="Abeokuta, Nigeria",
        region="Africa",
        active="1958–1997",
        genres=("Afrobeat", "Jazz", "Highlife", "Funk"),
        hue=45,
        bio=(
            "Multi-instrumentalist and bandleader Fela Anikulapo Kuti created"
            " Afrobeat, fusing Yoruba music, highlife, jazz and funk into long,"
            " politically charged grooves aimed at Nigeria's military rulers."
        ),
        facts=(
            (
                "He declared his Lagos compound, the Kalakuta Republic, independent of"
                " the Nigerian state."
            ),
            "'Zombie' mocked the Nigerian army; soldiers raided Kalakuta in 1977.",
            (
                "His sons Femi and Seun Kuti carry Afrobeat on; Seun leads his father's"
                " band Egypt 80."
            ),
        ),
        timeline=(
            CareerEvent(1958, "Studies in London", "Trinity College of Music."),
            CareerEvent(1963, "Forms Koola Lobitos"),
            CareerEvent(1970, "Africa 70 and Afrobeat", "With drummer Tony Allen."),
            CareerEvent(1977, "Zombie and the Kalakuta raid"),
            CareerEvent(
                1997, "Dies in Lagos", "Over a million people attend his funeral."
            ),
        ),
        albums=(
            Album("shakara", "Shakara", 1972, "EMI Nigeria"),
            Album("gentleman", "Gentleman", 1973, "EMI Nigeria"),
            Album("expensive-shit", "Expensive Shit", 1975, "Sound Workshop"),
            Album("water-no-get-enemy", "Water No Get Enemy", 1975, "EMI Nigeria"),
            Album(
                "zombie",
                "Zombie",
                1976,
                "Coconut",
                note="A satire of soldiers following orders without thought.",
                tracks=_tracks(("Zombie", "12:26"), ("Mister Follow Follow", "13:16")),
            ),
            Album(
                "sorrow-tears-and-blood", "Sorrow, Tears and Blood", 1977, "Kalakuta"
            ),
            Album("beasts-of-no-nation", "Beasts of No Nation", 1989, "Kalakuta"),
        ),
    ),
    Artist(
        id="bjork",
        name="Björk",
        kind="Solo artist",
        origin="Reykjavík, Iceland",
        region="Europe",
        active="1977–present",
        genres=("Experimental", "Electronic", "Art pop"),
        hue=170,
        bio=(
            "After fronting the Sugarcubes, Björk built a solo career that treats"
            " every album as a new world: string-and-beat hybrids, all-vocal"
            " records, app albums and flute-led utopias."
        ),
        facts=(
            "She released her first album in 1977, at age 11.",
            (
                "Biophilia (2011) was released as a suite of interactive apps; MoMA"
                " later acquired it for its collection."
            ),
            "Medúlla (2004) is built almost entirely from human voices.",
        ),
        timeline=(
            CareerEvent(1977, "Childhood debut album"),
            CareerEvent(
                1986, "The Sugarcubes form", "'Birthday' becomes an indie hit."
            ),
            CareerEvent(1993, "Debut"),
            CareerEvent(2000, "Dancer in the Dark", "Best Actress at Cannes."),
            CareerEvent(2011, "Biophilia"),
            CareerEvent(2022, "Fossora"),
        ),
        albums=(
            Album("debut", "Debut", 1993, "One Little Indian"),
            Album("post", "Post", 1995, "One Little Indian"),
            Album(
                "homogenic",
                "Homogenic",
                1997,
                "One Little Indian",
                note="Strings and volcanic beats, written as a portrait of Iceland.",
                tracks=_tracks(
                    ("Hunter", "4:15"),
                    ("Jóga", "5:05"),
                    ("Unravel", "3:21"),
                    ("Bachelorette", "5:16"),
                    ("All Neon Like", "5:53"),
                    ("5 Years", "4:29"),
                    ("Immature", "3:06"),
                    ("Alarm Call", "4:19"),
                    ("Pluto", "3:19"),
                    ("All Is Full of Love", "4:32"),
                ),
            ),
            Album("vespertine", "Vespertine", 2001, "One Little Indian"),
            Album("medulla", "Medúlla", 2004, "One Little Indian"),
            Album("volta", "Volta", 2007, "One Little Indian"),
            Album("biophilia", "Biophilia", 2011, "One Little Indian"),
            Album("vulnicura", "Vulnicura", 2015, "One Little Indian"),
            Album("utopia", "Utopia", 2017, "One Little Indian"),
            Album("fossora", "Fossora", 2022, "One Little Indian"),
        ),
    ),
    Artist(
        id="kendrick-lamar",
        name="Kendrick Lamar",
        kind="Solo artist",
        origin="Compton, California, USA",
        region="North America",
        active="2003–present",
        genres=("Hip hop", "Conscious rap", "Jazz rap"),
        hue=0,
        bio=(
            "Kendrick Lamar writes dense, cinematic rap albums about Compton,"
            " faith, fame and Black American life, often weaving jazz and funk"
            " into the production."
        ),
        facts=(
            (
                "DAMN. won the 2018 Pulitzer Prize for Music, the first winner outside"
                " classical music and jazz."
            ),
            "He headlined the Super Bowl LIX halftime show in February 2025.",
            (
                "To Pimp a Butterfly features Kamasi Washington, Thundercat and Flying"
                " Lotus."
            ),
        ),
        timeline=(
            CareerEvent(2004, "First mixtape as K-Dot"),
            CareerEvent(2012, "good kid, m.A.A.d city"),
            CareerEvent(2015, "To Pimp a Butterfly"),
            CareerEvent(2018, "Pulitzer Prize for Music", "Awarded for DAMN."),
            CareerEvent(2024, "GNX and 'Not Like Us'"),
            CareerEvent(2025, "Super Bowl LIX halftime show"),
        ),
        albums=(
            Album("section-80", "Section.80", 2011, "Top Dawg"),
            Album(
                "gkmc",
                "good kid, m.A.A.d city",
                2012,
                "Top Dawg / Aftermath / Interscope",
            ),
            Album(
                "tpab", "To Pimp a Butterfly", 2015, "Top Dawg / Aftermath / Interscope"
            ),
            Album(
                "damn",
                "DAMN.",
                2017,
                "Top Dawg / Aftermath / Interscope",
                note="Pulitzer Prize for Music, 2018.",
                tracks=_tracks(
                    ("BLOOD.", "1:58"),
                    ("DNA.", "3:05"),
                    ("YAH.", "2:40"),
                    ("ELEMENT.", "3:28"),
                    ("FEEL.", "3:34"),
                    ("LOYALTY.", "3:47"),
                    ("PRIDE.", "4:35"),
                    ("HUMBLE.", "2:57"),
                    ("LUST.", "5:07"),
                    ("LOVE.", "3:33"),
                    ("XXX.", "4:14"),
                    ("FEAR.", "7:40"),
                    ("GOD.", "4:08"),
                    ("DUCKWORTH.", "4:08"),
                ),
            ),
            Album(
                "mr-morale", "Mr. Morale & the Big Steppers", 2022, "pgLang / Top Dawg"
            ),
            Album("gnx", "GNX", 2024, "pgLang / Interscope"),
        ),
        tour=(
            TourDate("2027-01-22", "Los Angeles", "USA", "SoFi Stadium", "soldOut"),
            TourDate(
                "2027-01-29", "Atlanta", "USA", "Mercedes-Benz Stadium", "fewLeft"
            ),
            TourDate(
                "2027-03-05", "London", "UK", "Tottenham Hotspur Stadium", "onSale"
            ),
            TourDate("2027-03-12", "Paris", "France", "Stade de France", "onSale"),
            TourDate("2027-04-02", "Sydney", "Australia", "Accor Stadium", "onSale"),
        ),
    ),
    Artist(
        id="rosalia",
        name="Rosalía",
        kind="Solo artist",
        origin="Sant Esteve Sesrovires, Catalonia, Spain",
        region="Europe",
        active="2013–present",
        genres=("Flamenco pop", "Reggaeton", "Experimental pop"),
        hue=350,
        bio=(
            "Rosalía trained in flamenco and then pulled it into the present,"
            " mixing cante with reggaeton, trap, electronics and orchestral pop."
        ),
        facts=(
            (
                "El mal querer began as her final project for a flamenco degree at the"
                " Catalonia College of Music."
            ),
            (
                "El mal querer is structured in chapters inspired by the 13th-century"
                " Occitan novel Flamenca."
            ),
            "Motomami won the Latin Grammy for Album of the Year in 2022.",
        ),
        timeline=(
            CareerEvent(2017, "Los Ángeles", "A stark flamenco debut."),
            CareerEvent(2018, "El mal querer", "'Malamente' breaks through."),
            CareerEvent(2019, "Latin Grammy Album of the Year"),
            CareerEvent(2022, "Motomami"),
            CareerEvent(2025, "Lux"),
        ),
        albums=(
            Album("los-angeles", "Los Ángeles", 2017, "Universal Spain"),
            Album("el-mal-querer", "El mal querer", 2018, "Sony Music"),
            Album(
                "motomami",
                "Motomami",
                2022,
                "Columbia",
                note="Latin Grammy Album of the Year, 2022.",
                tracks=_tracks(
                    ("SAOKO", "2:17"),
                    ("CANDY", "3:13"),
                    ("LA FAMA", "3:08"),
                    ("BULERÍAS", "2:34"),
                    ("CHICKEN TERIYAKI", "2:03"),
                    ("HENTAI", "2:43"),
                    ("BIZCOCHITO", "1:49"),
                    ("G3 N15", "3:21"),
                    ("MOTOMAMI", "1:02"),
                    ("DIABLO", "2:39"),
                    ("DELIRIO DE GRANDEZA", "2:58"),
                    ("CUUUUuuuuuute", "2:20"),
                    ("COMO UN G", "3:10"),
                    ("Abcdefg", "0:58"),
                    ("LA COMBI VERSACE", "2:47"),
                    ("SAKURA", "2:28"),
                ),
            ),
            Album("lux", "Lux", 2025, "Columbia"),
        ),
        tour=(
            TourDate("2026-12-12", "Madrid", "Spain", "Movistar Arena", "soldOut"),
            TourDate("2026-12-15", "Barcelona", "Spain", "Palau Sant Jordi", "fewLeft"),
            TourDate(
                "2027-02-05",
                "Mexico City",
                "Mexico",
                "Palacio de los Deportes",
                "onSale",
            ),
            TourDate(
                "2027-02-12", "Buenos Aires", "Argentina", "Movistar Arena", "onSale"
            ),
        ),
    ),
    Artist(
        id="ar-rahman",
        name="A. R. Rahman",
        kind="Composer",
        origin="Chennai, India",
        region="Asia",
        active="1992–present",
        genres=("Film score", "Indian classical fusion", "Sufi", "Electronic"),
        hue=265,
        bio=(
            "A. R. Rahman reshaped Indian film music in the 1990s with digital"
            " production, Carnatic and Sufi influences and huge melodies, and"
            " later won two Oscars for Slumdog Millionaire."
        ),
        facts=(
            (
                "Slumdog Millionaire won him two Academy Awards in 2009: Best Original"
                " Score and Best Original Song for 'Jai Ho'."
            ),
            (
                "Time listed Roja, his debut score, among its 10 best soundtracks of"
                " all time."
            ),
            "He founded the KM Music Conservatory in Chennai in 2008.",
        ),
        timeline=(
            CareerEvent(1992, "Roja", "His debut film score."),
            CareerEvent(1998, "Dil Se..", "'Chaiyya Chaiyya'."),
            CareerEvent(2002, "Bombay Dreams", "A West End musical."),
            CareerEvent(2008, "KM Music Conservatory founded"),
            CareerEvent(2009, "Two Academy Awards", "For Slumdog Millionaire."),
        ),
        albums=(
            Album("roja", "Roja", 1992, "Lahari Music", kind="Soundtrack"),
            Album("bombay", "Bombay", 1995, "Pyramid", kind="Soundtrack"),
            Album("dil-se", "Dil Se..", 1998, "Venus", kind="Soundtrack"),
            Album("lagaan", "Lagaan", 2001, "Sony Music", kind="Soundtrack"),
            Album(
                "rang-de-basanti",
                "Rang De Basanti",
                2006,
                "Sony BMG",
                kind="Soundtrack",
            ),
            Album(
                "slumdog-millionaire",
                "Slumdog Millionaire",
                2008,
                "Interscope",
                kind="Soundtrack",
            ),
            Album("rockstar", "Rockstar", 2011, "T-Series", kind="Soundtrack"),
        ),
    ),
    Artist(
        id="celia-cruz",
        name="Celia Cruz",
        kind="Solo artist",
        origin="Havana, Cuba",
        region="Latin America",
        active="1948–2003",
        genres=("Salsa", "Son cubano", "Guaracha"),
        hue=310,
        bio=(
            "The 'Queen of Salsa' sang with La Sonora Matancera in 1950s Havana,"
            " went into exile in 1960 and became the defining voice of New York's"
            " Fania-era salsa."
        ),
        facts=(
            "Her onstage cry '¡Azúcar!' (Sugar!) became her signature.",
            (
                "She left Cuba in 1960 and was never allowed to return, even for her"
                " mother's funeral."
            ),
            (
                "In 2024 she appeared on a US quarter in the American Women Quarters"
                " program."
            ),
        ),
        timeline=(
            CareerEvent(1950, "Joins La Sonora Matancera"),
            CareerEvent(1960, "Leaves Cuba"),
            CareerEvent(1974, "Celia & Johnny", "With Johnny Pacheco on Vaya/Fania."),
            CareerEvent(1994, "National Medal of Arts"),
            CareerEvent(2003, "Regalo del Alma", "Released after her death."),
        ),
        albums=(
            Album(
                "celia-and-johnny",
                "Celia & Johnny",
                1974,
                "Vaya",
                note="With Johnny Pacheco.",
            ),
            Album(
                "celia-y-willie",
                "Celia y Willie",
                1981,
                "Vaya",
                note="With Willie Colón.",
            ),
            Album("azucar-negra", "Azúcar Negra", 1993, "RMM"),
            Album("mi-vida-es-cantar", "Mi Vida Es Cantar", 1998, "RMM"),
            Album(
                "la-negra-tiene-tumbao", "La Negra Tiene Tumbao", 2001, "Sony Discos"
            ),
            Album("regalo-del-alma", "Regalo del Alma", 2003, "Sony Discos"),
        ),
    ),
    Artist(
        id="ryuichi-sakamoto",
        name="Ryuichi Sakamoto",
        kind="Composer",
        origin="Tokyo, Japan",
        region="Asia",
        active="1975–2023",
        genres=("Electronic", "Ambient", "Film score", "Contemporary classical"),
        hue=195,
        bio=(
            "A founder of Yellow Magic Orchestra, Ryuichi Sakamoto helped invent"
            " synth-pop, then became an Oscar-winning film composer and a quiet"
            " pioneer of ambient piano and sound art."
        ),
        facts=(
            (
                "He shared the 1988 Academy Award for Best Original Score for The Last"
                " Emperor with David Byrne and Cong Su."
            ),
            (
                "He acted opposite David Bowie in Merry Christmas, Mr. Lawrence (1983),"
                " which he also scored."
            ),
            (
                "His final album, 12, is a set of piano sketches titled by the date"
                " they were recorded."
            ),
        ),
        timeline=(
            CareerEvent(1978, "Yellow Magic Orchestra and Thousand Knives"),
            CareerEvent(1983, "Merry Christmas, Mr. Lawrence"),
            CareerEvent(1988, "Academy Award", "For The Last Emperor."),
            CareerEvent(2017, "async"),
            CareerEvent(2023, "12", "Released weeks before his death."),
        ),
        albums=(
            Album("thousand-knives", "Thousand Knives", 1978, "Nippon Columbia"),
            Album("b-2-unit", "B-2 Unit", 1980, "Alfa"),
            Album(
                "merry-christmas-mr-lawrence",
                "Merry Christmas, Mr. Lawrence",
                1983,
                "Virgin",
                kind="Soundtrack",
            ),
            Album(
                "the-last-emperor",
                "The Last Emperor",
                1987,
                "Virgin",
                kind="Soundtrack",
            ),
            Album("async", "async", 2017, "Milan"),
            Album("twelve", "12", 2023, "Milan"),
        ),
    ),
    Artist(
        id="gurrumul",
        name="Gurrumul",
        kind="Solo artist",
        origin="Galiwin'ku, Elcho Island, Australia",
        region="Oceania",
        active="1980s–2017",
        genres=("Yolŋu song", "Folk", "Gospel", "Orchestral"),
        hue=140,
        bio=(
            "Geoffrey Gurrumul Yunupingu, a Yolŋu man of the Gumatj clan, sang"
            " mostly in Yolŋu Matha languages. His gentle voice made him one of"
            " Australia's best-selling and most loved artists."
        ),
        facts=(
            (
                "Born blind, he taught himself to play a right-handed guitar upside"
                " down, left-handed."
            ),
            (
                "Djarimirri (Child of the Rainbow) was the first album sung in an"
                " Indigenous Australian language to reach No. 1 on the ARIA chart."
            ),
            "He played with Yothu Yindi and later co-founded Saltwater Band.",
        ),
        timeline=(
            CareerEvent(1989, "Plays with Yothu Yindi"),
            CareerEvent(2008, "Gurrumul", "His debut solo album."),
            CareerEvent(2011, "Rrakala"),
            CareerEvent(2015, "The Gospel Album"),
            CareerEvent(
                2018, "Djarimirri reaches No. 1", "Released after his death in 2017."
            ),
        ),
        albums=(
            Album("gurrumul", "Gurrumul", 2008, "Skinnyfish Music"),
            Album("rrakala", "Rrakala", 2011, "Skinnyfish Music"),
            Album("the-gospel-album", "The Gospel Album", 2015, "Skinnyfish Music"),
            Album(
                "djarimirri",
                "Djarimirri (Child of the Rainbow)",
                2018,
                "Skinnyfish Music",
            ),
        ),
    ),
    Artist(
        id="angelique-kidjo",
        name="Angélique Kidjo",
        kind="Solo artist",
        origin="Ouidah, Benin",
        region="Africa",
        active="1980s–present",
        genres=("Afropop", "World fusion", "Jazz"),
        hue=20,
        bio=(
            "Angélique Kidjo mixes the music of Benin with funk, jazz, Afro-Cuban"
            " and rock. She is one of the most celebrated African artists and a"
            " five-time Grammy winner."
        ),
        facts=(
            "She has won five Grammy Awards.",
            "Her album Celia (2019) is a tribute to Celia Cruz.",
            (
                "Her 2018 album reimagined Talking Heads' Remain in Light with West"
                " African rhythms."
            ),
        ),
        timeline=(
            CareerEvent(1983, "Moves to Paris"),
            CareerEvent(1991, "Logozo", "Her international breakthrough."),
            CareerEvent(2008, "First Grammy", "For Djin Djin."),
            CareerEvent(2019, "Celia", "A tribute to Celia Cruz."),
            CareerEvent(2023, "Polar Music Prize"),
        ),
        albums=(
            Album("logozo", "Logozo", 1991, "Mango"),
            Album("aye", "Ayé", 1994, "Mango"),
            Album("oremi", "Oremi", 1998, "Island"),
            Album("djin-djin", "Djin Djin", 2007, "Razor & Tie"),
            Album("eve", "Eve", 2014, "429 Records"),
            Album("remain-in-light", "Remain in Light", 2018, "Kravenworks"),
            Album("celia", "Celia", 2019, "Verve"),
            Album("mother-nature", "Mother Nature", 2021, "Decca"),
        ),
        tour=(
            TourDate("2026-11-21", "Cotonou", "Benin", "Palais des Congrès", "onSale"),
            TourDate("2026-11-29", "Paris", "France", "L'Olympia", "fewLeft"),
            TourDate("2027-01-16", "New York", "USA", "Carnegie Hall", "onSale"),
            TourDate("2027-01-24", "Toronto", "Canada", "Massey Hall", "onSale"),
        ),
    ),
    Artist(
        id="arooj-aftab",
        name="Arooj Aftab",
        kind="Solo artist",
        origin="Lahore, Pakistan / Brooklyn, USA",
        region="Asia",
        active="2015–present",
        genres=("Neo-Sufi", "Jazz", "Minimalism", "Ambient"),
        hue=230,
        bio=(
            "Arooj Aftab sets Urdu poetry and Sufi traditions to slow, spacious"
            " jazz and minimalist arrangements of harp, bass and strings."
        ),
        facts=(
            (
                "In 2022 she became the first Pakistani artist to win a Grammy, for"
                " 'Mohabbat' (Best Global Music Performance)."
            ),
            "She studied at Berklee College of Music in Boston.",
            (
                "Love in Exile (2023) is an improvised trio record with Vijay Iyer and"
                " Shahzad Ismaily."
            ),
        ),
        timeline=(
            CareerEvent(2005, "Moves to the US", "Studies at Berklee."),
            CareerEvent(2015, "Bird Under Water"),
            CareerEvent(2021, "Vulture Prince"),
            CareerEvent(2022, "Grammy for 'Mohabbat'"),
            CareerEvent(2024, "Night Reign"),
        ),
        albums=(
            Album("bird-under-water", "Bird Under Water", 2015, "Self-released"),
            Album("siren-islands", "Siren Islands", 2018, "New Amsterdam"),
            Album(
                "vulture-prince",
                "Vulture Prince",
                2021,
                "New Amsterdam",
                note="Includes the Grammy-winning 'Mohabbat'.",
                tracks=_tracks(
                    ("Baghon Main", "8:00"),
                    ("Inayaat", "6:57"),
                    ("Mohabbat", "7:57"),
                    ("Diya Hai", "6:34"),
                    ("Last Night", "4:40"),
                    ("Suroor", "6:02"),
                    ("Saans Lo", "7:43"),
                ),
            ),
            Album(
                "love-in-exile",
                "Love in Exile",
                2023,
                "Verve",
                note="With Vijay Iyer and Shahzad Ismaily.",
            ),
            Album("night-reign", "Night Reign", 2024, "Verve"),
        ),
        tour=(
            TourDate("2026-11-26", "Brooklyn", "USA", "Kings Theatre", "fewLeft"),
            TourDate("2026-12-03", "Chicago", "USA", "Thalia Hall", "soldOut"),
            TourDate(
                "2027-01-30", "Lahore", "Pakistan", "Alhamra Arts Council", "onSale"
            ),
            TourDate(
                "2027-02-20",
                "Melbourne",
                "Australia",
                "Melbourne Recital Centre",
                "onSale",
            ),
        ),
    ),
    Artist(
        id="johnny-cash",
        name="Johnny Cash",
        kind="Solo artist",
        origin="Kingsland, Arkansas, USA",
        region="North America",
        active="1954–2003",
        genres=("Country", "Rockabilly", "Folk", "Gospel"),
        hue=240,
        bio=(
            "The 'Man in Black' started at Sun Records alongside Elvis Presley,"
            " recorded legendary prison concerts and ended his career with Rick"
            " Rubin's stripped-back American Recordings series."
        ),
        facts=(
            "He explained his all-black stage clothes in the 1971 song 'Man in Black'.",
            "Merle Haggard saw him play San Quentin in 1958 while an inmate there.",
            (
                "His 2002 cover of Nine Inch Nails' 'Hurt' is one of his most"
                " celebrated late recordings."
            ),
        ),
        timeline=(
            CareerEvent(
                1955, "First Sun Records single", "'Hey Porter' / 'Cry! Cry! Cry!'."
            ),
            CareerEvent(1956, "'I Walk the Line'"),
            CareerEvent(
                1968, "At Folsom Prison", "He marries June Carter the same year."
            ),
            CareerEvent(1994, "American Recordings", "With producer Rick Rubin."),
            CareerEvent(2003, "Dies in Nashville"),
        ),
        albums=(
            Album(
                "hot-and-blue-guitar",
                "Johnny Cash with His Hot and Blue Guitar!",
                1957,
                "Sun",
            ),
            Album("ride-this-train", "Ride This Train", 1960, "Columbia"),
            Album(
                "at-folsom-prison",
                "At Folsom Prison",
                1968,
                "Columbia",
                kind="Live album",
            ),
            Album(
                "at-san-quentin", "At San Quentin", 1969, "Columbia", kind="Live album"
            ),
            Album("american-recordings", "American Recordings", 1994, "American"),
            Album("american-iv", "American IV: The Man Comes Around", 2002, "American"),
        ),
    ),
    Artist(
        id="mercedes-sosa",
        name="Mercedes Sosa",
        kind="Solo artist",
        origin="San Miguel de Tucumán, Argentina",
        region="Latin America",
        active="1950–2009",
        genres=("Nueva canción", "Folk", "Zamba"),
        hue=60,
        bio=(
            "'La Negra' gave voice to Argentina's Nuevo Cancionero movement and"
            " became a symbol of resistance across Latin America during the"
            " years of dictatorship."
        ),
        facts=(
            (
                "She was arrested on stage in La Plata in 1979 and lived in exile in"
                " Europe until 1982."
            ),
            (
                "Her version of Violeta Parra's 'Gracias a la vida' became an anthem"
                " across Latin America."
            ),
            "She won a radio singing contest at 15, under a false name.",
        ),
        timeline=(
            CareerEvent(1950, "Wins a radio contest at 15"),
            CareerEvent(1963, "Nuevo Cancionero manifesto"),
            CareerEvent(1979, "Arrested on stage, goes into exile"),
            CareerEvent(
                1982, "Returns to Argentina", "Sold-out shows at Teatro Ópera."
            ),
            CareerEvent(2009, "Cantora", "Her final album."),
        ),
        albums=(
            Album("la-voz-de-la-zafra", "La voz de la zafra", 1962, "RCA Victor"),
            Album("mujeres-argentinas", "Mujeres argentinas", 1969, "Philips"),
            Album(
                "homenaje-a-violeta-parra", "Homenaje a Violeta Parra", 1971, "Philips"
            ),
            Album("corazon-libre", "Corazón libre", 2005, "Universal"),
            Album("cantora-1", "Cantora 1", 2009, "Sony Music"),
        ),
    ),
    Artist(
        id="bts",
        name="BTS",
        kind="Band",
        origin="Seoul, South Korea",
        region="Asia",
        active="2013–present",
        genres=("K-pop", "Hip hop", "Pop"),
        hue=280,
        bio=(
            "The seven-member group RM, Jin, Suga, j-hope, Jimin, V and Jung Kook"
            " grew from a hip-hop-leaning idol group into the biggest act in"
            " K-pop history."
        ),
        facts=(
            (
                "Love Yourself: Tear (2018) was the first K-pop album to top the US"
                " Billboard 200."
            ),
            "'Dynamite' (2020) was their first Billboard Hot 100 No. 1.",
            "They spoke at the UN General Assembly in 2018 for UNICEF.",
        ),
        timeline=(
            CareerEvent(2013, "Debut with 2 Cool 4 Skool"),
            CareerEvent(2018, "First Billboard 200 No. 1"),
            CareerEvent(2020, "'Dynamite'"),
            CareerEvent(2022, "Hiatus for military service"),
        ),
        albums=(
            Album("wings", "Wings", 2016, "Big Hit"),
            Album("love-yourself-tear", "Love Yourself: Tear", 2018, "Big Hit"),
            Album("map-of-the-soul-7", "Map of the Soul: 7", 2020, "Big Hit"),
            Album("be", "BE", 2020, "Big Hit"),
            Album("proof", "Proof", 2022, "Big Hit", kind="Anthology"),
        ),
    ),
)

_ARTISTS_BY_ID = {artist.id: artist for artist in ARTISTS}
_ALBUMS_BY_ID = {
    album.id: (album, artist) for artist in ARTISTS for album in artist.albums
}


class UnknownRecordError(KeyError):
    """Raised when an artist or album id is not in the demo database."""


def get_artist(artist_id: str) -> Artist:
    try:
        return _ARTISTS_BY_ID[artist_id]
    except KeyError:
        raise UnknownRecordError(
            f"Unknown artistId '{artist_id}'. Known ids: {', '.join(_ARTISTS_BY_ID)}"
        ) from None


def get_album(album_id: str) -> tuple[Album, Artist]:
    """Returns the album and the artist that released it."""
    try:
        return _ALBUMS_BY_ID[album_id]
    except KeyError:
        raise UnknownRecordError(f"Unknown albumId '{album_id}'.") from None


def album_hue(artist: Artist, album: Album) -> int:
    """Spreads an artist's albums around the color wheel near the artist hue."""
    index = artist.albums.index(album)
    return (artist.hue + index * 37) % 360


def find_artists(query: str = "", touring: bool | None = None) -> list[Artist]:
    """Case-insensitive search over names, places, genres, bios, facts and albums."""
    needle = query.strip().lower()
    results = []
    for artist in ARTISTS:
        haystack = " ".join([
            artist.name,
            artist.origin,
            artist.region,
            artist.active,
            artist.bio,
            *artist.genres,
            *artist.facts,
            *(f"{e.title} {e.detail}" for e in artist.timeline),
            *(a.title for a in artist.albums),
        ]).lower()
        if needle and needle not in haystack:
            continue
        if touring is not None and bool(artist.tour) != touring:
            continue
        results.append(artist)
    return results

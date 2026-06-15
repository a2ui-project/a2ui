# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
OpenStax Module Index for Biology AP Courses.

This module provides a complete index of all modules in the OpenStax Biology AP Courses textbook,
with keyword-based search capabilities for fast topic matching.

The module index is built from the collection XML:
https://github.com/openstax/osbooks-biology-bundle/blob/main/collections/biology-ap-courses.collection.xml

Module content is fetched from:
- GCS bucket (primary): gs://{bucket}/openstax_modules/{module_id}/index.cnxml
- GitHub (fallback): https://raw.githubusercontent.com/openstax/osbooks-biology-bundle/main/modules/{module_id}/index.cnxml

Citations link to the user-friendly OpenStax website:
https://openstax.org/books/biology-ap-courses/pages/{chapter-slug}
"""

import re
from typing import Optional

# Base URL for OpenStax textbook
OPENSTAX_BASE_URL = "https://openstax.org/books/biology-ap-courses/pages"

# Module ID to chapter slug mapping for URL generation
# The chapter slugs match the actual OpenStax website URL structure
MODULE_TO_CHAPTER_SLUG = {
    # Metabolism chapter (6)
    "m62761": "6-introduction",
    "m62763": "6-1-energy-and-metabolism",
    "m62764": "6-2-potential-kinetic-free-and-activation-energy",
    "m62767": "6-3-the-laws-of-thermodynamics",
    "m62768": "6-4-atp-adenosine-triphosphate",
    "m62778": "6-5-enzymes",
    # Cellular Respiration chapter (7)
    "m62784": "7-introduction",
    "m62786": "7-1-energy-in-living-systems",
    "m62787": "7-2-glycolysis",
    "m62788": "7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle",
    "m62789": "7-4-oxidative-phosphorylation",
    "m62790": "7-5-metabolism-without-oxygen",
    "m62791": "7-6-connections-of-carbohydrate-protein-and-lipid-metabolic-pathways",
    "m62792": "7-7-regulation-of-cellular-respiration",
    # Photosynthesis chapter (8)
    "m62793": "8-introduction",
    "m62794": "8-1-overview-of-photosynthesis",
    "m62795": "8-2-the-light-dependent-reaction-of-photosynthesis",
    "m62796": "8-3-using-light-to-make-organic-molecules",
    # Cell Structure chapter (4)
    "m62736": "4-introduction",
    "m62738": "4-1-studying-cells",
    "m62740": "4-2-prokaryotic-cells",
    "m62742": "4-3-eukaryotic-cells",
    "m62743": "4-4-the-endomembrane-system-and-proteins",
    "m62744": "4-5-cytoskeleton",
    "m62746": "4-6-connections-between-cells-and-cellular-activities",
    # Plasma Membranes chapter (5)
    "m62780": "5-introduction",
    "m62773": "5-1-components-and-structure",
    "m62753": "5-2-passive-transport",
    "m62770": "5-3-active-transport",
    "m62772": "5-4-bulk-transport",
    # Cell Communication chapter (9)
    "m62797": "9-introduction",
    "m62798": "9-1-signaling-molecules-and-cellular-receptors",
    "m62799": "9-2-propagation-of-the-signal",
    "m62800": "9-3-response-to-the-signal",
    "m62801": "9-4-signaling-in-single-celled-organisms",
    # Cell Reproduction chapter (10)
    "m62802": "10-introduction",
    "m62803": "10-1-cell-division",
    "m62804": "10-2-the-cell-cycle",
    "m62805": "10-3-control-of-the-cell-cycle",
    "m62806": "10-4-cancer-and-the-cell-cycle",
    "m62808": "10-5-prokaryotic-cell-division",
    # Meiosis chapter (11)
    "m62809": "11-introduction",
    "m62810": "11-1-the-process-of-meiosis",
    "m62811": "11-2-sexual-reproduction",
    # Mendel's Experiments chapter (12)
    "m62812": "12-introduction",
    "m62813": "12-1-mendels-experiments-and-the-laws-of-probability",
    "m62817": "12-2-characteristics-and-traits",
    "m62819": "12-3-laws-of-inheritance",
    # Modern Inheritance chapter (13)
    "m62820": "13-introduction",
    "m62821": "13-1-chromosomal-theory-and-genetic-linkages",
    "m62822": "13-2-chromosomal-basis-of-inherited-disorders",
    # DNA Structure chapter (14)
    "m62823": "14-introduction",
    "m62824": "14-1-historical-basis-of-modern-understanding",
    "m62825": "14-2-dna-structure-and-sequencing",
    "m62826": "14-3-basics-of-dna-replication",
    "m62828": "14-4-dna-replication-in-prokaryotes",
    "m62829": "14-5-dna-replication-in-eukaryotes",
    "m62830": "14-6-dna-repair",
    # Genes and Proteins chapter (15)
    "m62833": "15-introduction",
    "m62837": "15-1-the-genetic-code",
    "m62838": "15-2-prokaryotic-transcription",
    "m62840": "15-3-eukaryotic-transcription",
    "m62842": "15-4-rna-processing-in-eukaryotes",
    "m62843": "15-5-ribosomes-and-protein-synthesis",
    # Gene Regulation chapter (16)
    "m62844": "16-introduction",
    "m62845": "16-1-regulation-of-gene-expression",
    "m62846": "16-2-prokaryotic-gene-regulation",
    "m62847": "16-3-eukaryotic-epigenetic-gene-regulation",
    "m62848": "16-4-eukaryotic-transcriptional-gene-regulation",
    "m62849": "16-5-eukaryotic-post-transcriptional-gene-regulation",
    "m62850": "16-6-eukaryotic-translational-and-post-translational-gene-regulation",
    "m62851": "16-7-cancer-and-gene-regulation",
    # Biotechnology chapter (17)
    "m62852": "17-introduction",
    "m62853": "17-1-biotechnology",
    "m62855": "17-2-mapping-genomes",
    "m62857": "17-3-whole-genome-sequencing",
    "m62860": "17-4-applying-genomics",
    "m62861": "17-5-genomics-and-proteomics",
    # Evolution chapter (18)
    "m62862": "18-introduction",
    "m62863": "18-1-understanding-evolution",
    "m62864": "18-2-formation-of-new-species",
    "m62865": "18-3-reconnection-and-rates-of-speciation",
    # Population Evolution chapter (19)
    "m62866": "19-introduction",
    "m62868": "19-1-population-evolution",
    "m62870": "19-2-population-genetics",
    "m62871": "19-3-adaptive-evolution",
    # Phylogenies chapter (20)
    "m62873": "20-introduction",
    "m62874": "20-1-organizing-life-on-earth",
    "m62903": "20-2-determining-evolutionary-relationships",
    "m62876": "20-3-perspectives-on-the-phylogenetic-tree",
    # Viruses chapter (21)
    "m62877": "21-introduction",
    "m62881": "21-1-viral-evolution-morphology-and-classification",
    "m62882": "21-2-virus-infection-and-hosts",
    "m62904": "21-3-prevention-and-treatment-of-viral-infections",
    "m62887": "21-4-other-acellular-entities-prions-and-viroids",
    # Prokaryotes chapter (22)
    "m62889": "22-introduction",
    "m62891": "22-1-prokaryotic-diversity",
    "m62893": "22-2-structure-of-prokaryotes",
    "m62894": "22-3-prokaryotic-metabolism",
    "m62896": "22-4-bacterial-diseases-in-humans",
    "m62897": "22-5-beneficial-prokaryotes",
    # Plants chapter (23)
    "m62899": "23-introduction",
    "m62951": "23-1-the-plant-body",
    "m62905": "23-2-stems",
    "m62906": "23-3-roots",
    "m62908": "23-4-leaves",
    "m62969": "23-5-transport-of-water-and-solutes-in-plants",
    "m62930": "23-6-plant-sensory-systems-and-responses",
    # Animal Body chapter (24)
    "m62912": "24-introduction",
    "m62916": "24-1-animal-form-and-function",
    "m62918": "24-2-animal-primary-tissues",
    "m62931": "24-3-homeostasis",
    # Nutrition and Digestion chapter (25)
    "m62933": "25-introduction",
    "m62919": "25-1-digestive-systems",
    "m62920": "25-2-nutrition-and-energy-production",
    "m62921": "25-3-digestive-system-processes",
    "m62922": "25-4-digestive-system-regulation",
    # Nervous System chapter (26)
    "m62923": "26-introduction",
    "m62924": "26-1-neurons-and-glial-cells",
    "m62925": "26-2-how-neurons-communicate",
    "m62926": "26-3-the-central-nervous-system",
    "m62928": "26-4-the-peripheral-nervous-system",
    "m62929": "26-5-nervous-system-disorders",
    # Sensory Systems chapter (27)
    "m62937": "27-introduction",
    "m62994": "27-1-sensory-processes",
    "m62946": "27-2-somatosensation",
    "m62947": "27-3-taste-and-smell",
    "m62954": "27-4-hearing-and-vestibular-sensation",
    "m62957": "27-5-vision",
    # Endocrine System chapter (28)
    "m62959": "28-introduction",
    "m62961": "28-1-types-of-hormones",
    "m62963": "28-2-how-hormones-work",
    "m62996": "28-3-regulation-of-body-processes",
    "m62971": "28-4-regulation-of-hormone-production",
    "m62995": "28-5-endocrine-glands",
    # Musculoskeletal System chapter (29)
    "m62976": "29-introduction",
    "m62977": "29-1-types-of-skeletal-systems",
    "m62978": "29-2-bone",
    "m62979": "29-3-joints-and-skeletal-movement",
    "m62980": "29-4-muscle-contraction-and-locomotion",
    # Respiratory System chapter (30)
    "m62981": "30-introduction",
    "m62982": "30-1-systems-of-gas-exchange",
    "m62998": "30-2-gas-exchange-across-respiratory-surfaces",
    "m62987": "30-3-breathing",
    "m62988": "30-4-transport-of-gases-in-human-bodily-fluids",
    # Circulatory System chapter (31)
    "m62989": "31-introduction",
    "m62990": "31-1-overview-of-the-circulatory-system",
    "m62991": "31-2-components-of-the-blood",
    "m62992": "31-3-mammalian-heart-and-blood-vessels",
    "m62993": "31-4-blood-flow-and-blood-pressure-regulation",
    # Osmotic Regulation chapter (32)
    "m62997": "32-introduction",
    "m63000": "32-1-osmoregulation-and-osmotic-balance",
    "m63001": "32-2-the-kidneys-and-osmoregulatory-organs",
    "m63002": "32-3-excretion-systems",
    "m63003": "32-4-nitrogenous-wastes",
    "m63004": "32-5-hormonal-control-of-osmoregulatory-functions",
    # Immune System chapter (33)
    "m63005": "33-introduction",
    "m63006": "33-1-innate-immune-response",
    "m63007": "33-2-adaptive-immune-response",
    "m63008": "33-3-antibodies",
    "m63009": "33-4-disruptions-in-the-immune-system",
    # Animal Reproduction chapter (34)
    "m63010": "34-introduction",
    "m63011": "34-1-reproduction-methods",
    "m63012": "34-2-fertilization",
    "m63013": "34-3-human-reproductive-anatomy-and-gametogenesis",
    "m63014": "34-4-hormonal-control-of-human-reproduction",
    "m63016": "34-5-fertilization-and-early-embryonic-development",
    "m63043": "34-6-organogenesis-and-vertebrate-axis-formation",
    "m63018": "34-7-human-pregnancy-and-birth",
    # Ecology chapter (35)
    "m63019": "35-introduction",
    "m63021": "35-1-the-scope-of-ecology",
    "m63023": "35-2-biogeography",
    "m63024": "35-3-terrestrial-biomes",
    "m63025": "35-4-aquatic-biomes",
    "m63026": "35-5-climate-and-the-effects-of-global-climate-change",
    # Population Ecology chapter (36)
    "m63027": "36-introduction",
    "m63028": "36-1-population-demography",
    "m63029": "36-2-life-histories-and-natural-selection",
    "m63030": "36-3-environmental-limits-to-population-growth",
    "m63031": "36-4-population-dynamics-and-regulation",
    "m63032": "36-5-human-population-growth",
    "m63033": "36-6-community-ecology",
    "m63034": "36-7-behavioral-biology-proximate-and-ultimate-causes-of-behavior",
    # Ecosystems chapter (37)
    "m63035": "37-introduction",
    "m63036": "37-1-ecology-for-ecosystems",
    "m63037": "37-2-energy-flow-through-ecosystems",
    "m63040": "37-3-biogeochemical-cycles",
    # Biodiversity chapter (38)
    "m63047": "38-introduction",
    "m63048": "38-1-the-biodiversity-crisis",
    "m63049": "38-2-the-importance-of-biodiversity-to-human-life",
    "m63050": "38-3-threats-to-biodiversity",
    "m63051": "38-4-preserving-biodiversity",
    # Chemistry chapters (1-3)
    "m62716": "1-introduction",
    "m62717": "1-1-the-science-of-biology",
    "m62718": "1-2-themes-and-concepts-of-biology",
    "m62719": "2-introduction",
    "m62720": "2-1-atoms-isotopes-ions-and-molecules-the-building-blocks",
    "m62721": "2-2-water",
    "m62722": "2-3-carbon",
    "m62723": "3-introduction",
    "m62724": "3-1-synthesis-of-biological-macromolecules",
    "m62726": "3-2-carbohydrates",
    "m62730": "3-3-lipids",
    "m62733": "3-4-proteins",
    "m62735": "3-5-nucleic-acids",
}

# Complete module index with titles, units, and chapters
# Generated from the collection XML
MODULE_INDEX = {
    "m45849": {
        "title": "The Periodic Table of Elements",
        "unit": "Front Matter",
        "chapter": "Front Matter",
    },
    "m60107": {
        "title": "Geological Time",
        "unit": "Front Matter",
        "chapter": "Front Matter",
    },
    "m62716": {
        "title": "Introduction",
        "unit": "The Chemistry of Life",
        "chapter": "The Study of Life",
    },
    "m62717": {
        "title": "The Science of Biology",
        "unit": "The Chemistry of Life",
        "chapter": "The Study of Life",
    },
    "m62718": {
        "title": "Themes and Concepts of Biology",
        "unit": "The Chemistry of Life",
        "chapter": "The Study of Life",
    },
    "m62719": {
        "title": "Introduction",
        "unit": "The Chemistry of Life",
        "chapter": "The Chemical Foundation of Life",
    },
    "m62720": {
        "title": "Atoms, Isotopes, Ions, and Molecules: The Building Blocks",
        "unit": "The Chemistry of Life",
        "chapter": "The Chemical Foundation of Life",
    },
    "m62721": {
        "title": "Water",
        "unit": "The Chemistry of Life",
        "chapter": "The Chemical Foundation of Life",
    },
    "m62722": {
        "title": "Carbon",
        "unit": "The Chemistry of Life",
        "chapter": "The Chemical Foundation of Life",
    },
    "m62723": {
        "title": "Introduction",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62724": {
        "title": "Synthesis of Biological Macromolecules",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62726": {
        "title": "Carbohydrates",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62730": {
        "title": "Lipids",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62733": {
        "title": "Proteins",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62735": {
        "title": "Nucleic Acids",
        "unit": "The Chemistry of Life",
        "chapter": "Biological Macromolecules",
    },
    "m62736": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62738": {
        "title": "Studying Cells",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62740": {
        "title": "Prokaryotic Cells",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62742": {
        "title": "Eukaryotic Cells",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62743": {
        "title": "The Endomembrane System and Proteins",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62744": {
        "title": "Cytoskeleton",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62746": {
        "title": "Connections between Cells and Cellular Activities",
        "unit": "The Cell",
        "chapter": "Cell Structure",
    },
    "m62753": {
        "title": "Passive Transport",
        "unit": "The Cell",
        "chapter": "Structure and Function of Plasma Membranes",
    },
    "m62761": {"title": "Introduction", "unit": "The Cell", "chapter": "Metabolism"},
    "m62763": {
        "title": "Energy and Metabolism",
        "unit": "The Cell",
        "chapter": "Metabolism",
    },
    "m62764": {
        "title": "Potential, Kinetic, Free, and Activation Energy",
        "unit": "The Cell",
        "chapter": "Metabolism",
    },
    "m62767": {
        "title": "The Laws of Thermodynamics",
        "unit": "The Cell",
        "chapter": "Metabolism",
    },
    "m62768": {
        "title": "ATP: Adenosine Triphosphate",
        "unit": "The Cell",
        "chapter": "Metabolism",
    },
    "m62770": {
        "title": "Active Transport",
        "unit": "The Cell",
        "chapter": "Structure and Function of Plasma Membranes",
    },
    "m62772": {
        "title": "Bulk Transport",
        "unit": "The Cell",
        "chapter": "Structure and Function of Plasma Membranes",
    },
    "m62773": {
        "title": "Components and Structure",
        "unit": "The Cell",
        "chapter": "Structure and Function of Plasma Membranes",
    },
    "m62778": {"title": "Enzymes", "unit": "The Cell", "chapter": "Metabolism"},
    "m62780": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Structure and Function of Plasma Membranes",
    },
    "m62784": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62786": {
        "title": "Energy in Living Systems",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62787": {
        "title": "Glycolysis",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62788": {
        "title": "Oxidation of Pyruvate and the Citric Acid Cycle",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62789": {
        "title": "Oxidative Phosphorylation",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62790": {
        "title": "Metabolism without Oxygen",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62791": {
        "title": "Connections of Carbohydrate, Protein, and Lipid Metabolic Pathways",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62792": {
        "title": "Regulation of Cellular Respiration",
        "unit": "The Cell",
        "chapter": "Cellular Respiration",
    },
    "m62793": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Photosynthesis",
    },
    "m62794": {
        "title": "Overview of Photosynthesis",
        "unit": "The Cell",
        "chapter": "Photosynthesis",
    },
    "m62795": {
        "title": "The Light-Dependent Reaction of Photosynthesis",
        "unit": "The Cell",
        "chapter": "Photosynthesis",
    },
    "m62796": {
        "title": "Using Light to Make Organic Molecules",
        "unit": "The Cell",
        "chapter": "Photosynthesis",
    },
    "m62797": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Cell Communication",
    },
    "m62798": {
        "title": "Signaling Molecules and Cellular Receptors",
        "unit": "The Cell",
        "chapter": "Cell Communication",
    },
    "m62799": {
        "title": "Propagation of the Signal",
        "unit": "The Cell",
        "chapter": "Cell Communication",
    },
    "m62800": {
        "title": "Response to the Signal",
        "unit": "The Cell",
        "chapter": "Cell Communication",
    },
    "m62801": {
        "title": "Signaling in Single-Celled Organisms",
        "unit": "The Cell",
        "chapter": "Cell Communication",
    },
    "m62802": {
        "title": "Introduction",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62803": {
        "title": "Cell Division",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62804": {
        "title": "The Cell Cycle",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62805": {
        "title": "Control of the Cell Cycle",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62806": {
        "title": "Cancer and the Cell Cycle",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62808": {
        "title": "Prokaryotic Cell Division",
        "unit": "The Cell",
        "chapter": "Cell Reproduction",
    },
    "m62809": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Meiosis and Sexual Reproduction",
    },
    "m62810": {
        "title": "The Process of Meiosis",
        "unit": "Genetics",
        "chapter": "Meiosis and Sexual Reproduction",
    },
    "m62811": {
        "title": "Sexual Reproduction",
        "unit": "Genetics",
        "chapter": "Meiosis and Sexual Reproduction",
    },
    "m62812": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Mendel's Experiments and Heredity",
    },
    "m62813": {
        "title": "Mendel's Experiments and the Laws of Probability",
        "unit": "Genetics",
        "chapter": "Mendel's Experiments and Heredity",
    },
    "m62817": {
        "title": "Characteristics and Traits",
        "unit": "Genetics",
        "chapter": "Mendel's Experiments and Heredity",
    },
    "m62819": {
        "title": "Laws of Inheritance",
        "unit": "Genetics",
        "chapter": "Mendel's Experiments and Heredity",
    },
    "m62820": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Modern Understandings of Inheritance",
    },
    "m62821": {
        "title": "Chromosomal Theory and Genetic Linkages",
        "unit": "Genetics",
        "chapter": "Modern Understandings of Inheritance",
    },
    "m62822": {
        "title": "Chromosomal Basis of Inherited Disorders",
        "unit": "Genetics",
        "chapter": "Modern Understandings of Inheritance",
    },
    "m62823": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62824": {
        "title": "Historical Basis of Modern Understanding",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62825": {
        "title": "DNA Structure and Sequencing",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62826": {
        "title": "Basics of DNA Replication",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62828": {
        "title": "DNA Replication in Prokaryotes",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62829": {
        "title": "DNA Replication in Eukaryotes",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62830": {
        "title": "DNA Repair",
        "unit": "Genetics",
        "chapter": "DNA Structure and Function",
    },
    "m62833": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62837": {
        "title": "The Genetic Code",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62838": {
        "title": "Prokaryotic Transcription",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62840": {
        "title": "Eukaryotic Transcription",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62842": {
        "title": "RNA Processing in Eukaryotes",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62843": {
        "title": "Ribosomes and Protein Synthesis",
        "unit": "Genetics",
        "chapter": "Genes and Proteins",
    },
    "m62844": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62845": {
        "title": "Regulation of Gene Expression",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62846": {
        "title": "Prokaryotic Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62847": {
        "title": "Eukaryotic Epigenetic Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62848": {
        "title": "Eukaryotic Transcriptional Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62849": {
        "title": "Eukaryotic Post-transcriptional Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62850": {
        "title": "Eukaryotic Translational and Post-translational Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62851": {
        "title": "Cancer and Gene Regulation",
        "unit": "Genetics",
        "chapter": "Gene Regulation",
    },
    "m62852": {
        "title": "Introduction",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62853": {
        "title": "Biotechnology",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62855": {
        "title": "Mapping Genomes",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62857": {
        "title": "Whole-Genome Sequencing",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62860": {
        "title": "Applying Genomics",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62861": {
        "title": "Genomics and Proteomics",
        "unit": "Genetics",
        "chapter": "Biotechnology and Genomics",
    },
    "m62862": {
        "title": "Introduction",
        "unit": "Evolutionary Processes",
        "chapter": "Evolution and Origin of Species",
    },
    "m62863": {
        "title": "Understanding Evolution",
        "unit": "Evolutionary Processes",
        "chapter": "Evolution and Origin of Species",
    },
    "m62864": {
        "title": "Formation of New Species",
        "unit": "Evolutionary Processes",
        "chapter": "Evolution and Origin of Species",
    },
    "m62865": {
        "title": "Reconnection and Rates of Speciation",
        "unit": "Evolutionary Processes",
        "chapter": "Evolution and Origin of Species",
    },
    "m62866": {
        "title": "Introduction",
        "unit": "Evolutionary Processes",
        "chapter": "The Evolution of Populations",
    },
    "m62868": {
        "title": "Population Evolution",
        "unit": "Evolutionary Processes",
        "chapter": "The Evolution of Populations",
    },
    "m62870": {
        "title": "Population Genetics",
        "unit": "Evolutionary Processes",
        "chapter": "The Evolution of Populations",
    },
    "m62871": {
        "title": "Adaptive Evolution",
        "unit": "Evolutionary Processes",
        "chapter": "The Evolution of Populations",
    },
    "m62873": {
        "title": "Introduction",
        "unit": "Evolutionary Processes",
        "chapter": "Phylogenies and the History of Life",
    },
    "m62874": {
        "title": "Organizing Life on Earth",
        "unit": "Evolutionary Processes",
        "chapter": "Phylogenies and the History of Life",
    },
    "m62876": {
        "title": "Perspectives on the Phylogenetic Tree",
        "unit": "Evolutionary Processes",
        "chapter": "Phylogenies and the History of Life",
    },
    "m62877": {
        "title": "Introduction",
        "unit": "Biological Diversity",
        "chapter": "Viruses",
    },
    "m62881": {
        "title": "Viral Evolution, Morphology, and Classification",
        "unit": "Biological Diversity",
        "chapter": "Viruses",
    },
    "m62882": {
        "title": "Virus Infection and Hosts",
        "unit": "Biological Diversity",
        "chapter": "Viruses",
    },
    "m62887": {
        "title": "Other Acellular Entities: Prions and Viroids",
        "unit": "Biological Diversity",
        "chapter": "Viruses",
    },
    "m62889": {
        "title": "Introduction",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62891": {
        "title": "Prokaryotic Diversity",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62893": {
        "title": "Structure of Prokaryotes",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62894": {
        "title": "Prokaryotic Metabolism",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62896": {
        "title": "Bacterial Diseases in Humans",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62897": {
        "title": "Beneficial Prokaryotes",
        "unit": "Biological Diversity",
        "chapter": "Prokaryotes: Bacteria and Archaea",
    },
    "m62899": {
        "title": "Introduction",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62903": {
        "title": "Determining Evolutionary Relationships",
        "unit": "Evolutionary Processes",
        "chapter": "Phylogenies and the History of Life",
    },
    "m62904": {
        "title": "Prevention and Treatment of Viral Infections",
        "unit": "Biological Diversity",
        "chapter": "Viruses",
    },
    "m62905": {
        "title": "Stems",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62906": {
        "title": "Roots",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62908": {
        "title": "Leaves",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62912": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Animal Body: Basic Form and Function",
    },
    "m62916": {
        "title": "Animal Form and Function",
        "unit": "Animal Structure and Function",
        "chapter": "The Animal Body: Basic Form and Function",
    },
    "m62918": {
        "title": "Animal Primary Tissues",
        "unit": "Animal Structure and Function",
        "chapter": "The Animal Body: Basic Form and Function",
    },
    "m62919": {
        "title": "Digestive Systems",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Nutrition and the Digestive System",
    },
    "m62920": {
        "title": "Nutrition and Energy Production",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Nutrition and the Digestive System",
    },
    "m62921": {
        "title": "Digestive System Processes",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Nutrition and the Digestive System",
    },
    "m62922": {
        "title": "Digestive System Regulation",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Nutrition and the Digestive System",
    },
    "m62923": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62924": {
        "title": "Neurons and Glial Cells",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62925": {
        "title": "How Neurons Communicate",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62926": {
        "title": "The Central Nervous System",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62928": {
        "title": "The Peripheral Nervous System",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62929": {
        "title": "Nervous System Disorders",
        "unit": "Animal Structure and Function",
        "chapter": "The Nervous System",
    },
    "m62930": {
        "title": "Plant Sensory Systems and Responses",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62931": {
        "title": "Homeostasis",
        "unit": "Animal Structure and Function",
        "chapter": "The Animal Body: Basic Form and Function",
    },
    "m62933": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Nutrition and the Digestive System",
    },
    "m62937": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62946": {
        "title": "Somatosensation",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62947": {
        "title": "Taste and Smell",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62951": {
        "title": "The Plant Body",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62954": {
        "title": "Hearing and Vestibular Sensation",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62957": {
        "title": "Vision",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62959": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62961": {
        "title": "Types of Hormones",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62963": {
        "title": "How Hormones Work",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62969": {
        "title": "Transport of Water and Solutes in Plants",
        "unit": "Plant Structure and Function",
        "chapter": "Plant Form and Physiology",
    },
    "m62971": {
        "title": "Regulation of Hormone Production",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62976": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Musculoskeletal System",
    },
    "m62977": {
        "title": "Types of Skeletal Systems",
        "unit": "Animal Structure and Function",
        "chapter": "The Musculoskeletal System",
    },
    "m62978": {
        "title": "Bone",
        "unit": "Animal Structure and Function",
        "chapter": "The Musculoskeletal System",
    },
    "m62979": {
        "title": "Joints and Skeletal Movement",
        "unit": "Animal Structure and Function",
        "chapter": "The Musculoskeletal System",
    },
    "m62980": {
        "title": "Muscle Contraction and Locomotion",
        "unit": "Animal Structure and Function",
        "chapter": "The Musculoskeletal System",
    },
    "m62981": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Respiratory System",
    },
    "m62982": {
        "title": "Systems of Gas Exchange",
        "unit": "Animal Structure and Function",
        "chapter": "The Respiratory System",
    },
    "m62987": {
        "title": "Breathing",
        "unit": "Animal Structure and Function",
        "chapter": "The Respiratory System",
    },
    "m62988": {
        "title": "Transport of Gases in Human Bodily Fluids",
        "unit": "Animal Structure and Function",
        "chapter": "The Respiratory System",
    },
    "m62989": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Circulatory System",
    },
    "m62990": {
        "title": "Overview of the Circulatory System",
        "unit": "Animal Structure and Function",
        "chapter": "The Circulatory System",
    },
    "m62991": {
        "title": "Components of the Blood",
        "unit": "Animal Structure and Function",
        "chapter": "The Circulatory System",
    },
    "m62992": {
        "title": "Mammalian Heart and Blood Vessels",
        "unit": "Animal Structure and Function",
        "chapter": "The Circulatory System",
    },
    "m62993": {
        "title": "Blood Flow and Blood Pressure Regulation",
        "unit": "Animal Structure and Function",
        "chapter": "The Circulatory System",
    },
    "m62994": {
        "title": "Sensory Processes",
        "unit": "Animal Structure and Function",
        "chapter": "Sensory Systems",
    },
    "m62995": {
        "title": "Endocrine Glands",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62996": {
        "title": "Regulation of Body Processes",
        "unit": "Animal Structure and Function",
        "chapter": "The Endocrine System",
    },
    "m62997": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m62998": {
        "title": "Gas Exchange across Respiratory Surfaces",
        "unit": "Animal Structure and Function",
        "chapter": "The Respiratory System",
    },
    "m63000": {
        "title": "Osmoregulation and Osmotic Balance",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m63001": {
        "title": "The Kidneys and Osmoregulatory Organs",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m63002": {
        "title": "Excretion Systems",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m63003": {
        "title": "Nitrogenous Wastes",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m63004": {
        "title": "Hormonal Control of Osmoregulatory Functions",
        "unit": "Animal Structure and Function",
        "chapter": "Osmotic Regulation and Excretion",
    },
    "m63005": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "The Immune System",
    },
    "m63006": {
        "title": "Innate Immune Response",
        "unit": "Animal Structure and Function",
        "chapter": "The Immune System",
    },
    "m63007": {
        "title": "Adaptive Immune Response",
        "unit": "Animal Structure and Function",
        "chapter": "The Immune System",
    },
    "m63008": {
        "title": "Antibodies",
        "unit": "Animal Structure and Function",
        "chapter": "The Immune System",
    },
    "m63009": {
        "title": "Disruptions in the Immune System",
        "unit": "Animal Structure and Function",
        "chapter": "The Immune System",
    },
    "m63010": {
        "title": "Introduction",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63011": {
        "title": "Reproduction Methods",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63012": {
        "title": "Fertilization",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63013": {
        "title": "Human Reproductive Anatomy and Gametogenesis",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63014": {
        "title": "Hormonal Control of Human Reproduction",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63016": {
        "title": "Fertilization and Early Embryonic Development",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63018": {
        "title": "Human Pregnancy and Birth",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63019": {
        "title": "Introduction",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63021": {
        "title": "The Scope of Ecology",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63023": {
        "title": "Biogeography",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63024": {
        "title": "Terrestrial Biomes",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63025": {
        "title": "Aquatic Biomes",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63026": {
        "title": "Climate and the Effects of Global Climate Change",
        "unit": "Ecology",
        "chapter": "Ecology and the Biosphere",
    },
    "m63027": {
        "title": "Introduction",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63028": {
        "title": "Population Demography",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63029": {
        "title": "Life Histories and Natural Selection",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63030": {
        "title": "Environmental Limits to Population Growth",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63031": {
        "title": "Population Dynamics and Regulation",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63032": {
        "title": "Human Population Growth",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63033": {
        "title": "Community Ecology",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63034": {
        "title": "Behavioral Biology: Proximate and Ultimate Causes of Behavior",
        "unit": "Ecology",
        "chapter": "Population and Community Ecology",
    },
    "m63035": {"title": "Introduction", "unit": "Ecology", "chapter": "Ecosystems"},
    "m63036": {
        "title": "Ecology for Ecosystems",
        "unit": "Ecology",
        "chapter": "Ecosystems",
    },
    "m63037": {
        "title": "Energy Flow through Ecosystems",
        "unit": "Ecology",
        "chapter": "Ecosystems",
    },
    "m63040": {
        "title": "Biogeochemical Cycles",
        "unit": "Ecology",
        "chapter": "Ecosystems",
    },
    "m63043": {
        "title": "Organogenesis and Vertebrate Axis Formation",
        "unit": "Animal Structure and Function",
        "chapter": "Animal Reproduction and Development",
    },
    "m63047": {
        "title": "Introduction",
        "unit": "Ecology",
        "chapter": "Conservation Biology and Biodiversity",
    },
    "m63048": {
        "title": "The Biodiversity Crisis",
        "unit": "Ecology",
        "chapter": "Conservation Biology and Biodiversity",
    },
    "m63049": {
        "title": "The Importance of Biodiversity to Human Life",
        "unit": "Ecology",
        "chapter": "Conservation Biology and Biodiversity",
    },
    "m63050": {
        "title": "Threats to Biodiversity",
        "unit": "Ecology",
        "chapter": "Conservation Biology and Biodiversity",
    },
    "m63051": {
        "title": "Preserving Biodiversity",
        "unit": "Ecology",
        "chapter": "Conservation Biology and Biodiversity",
    },
    "m64279": {"title": "Preface", "unit": "Front Matter", "chapter": "Front Matter"},
    "m66717": {
        "title": "Measurements and the Metric System",
        "unit": "Front Matter",
        "chapter": "Front Matter",
    },
}

# Expanded keyword mappings to module IDs
# Keywords are lowercase and map directly to specific modules
KEYWORD_TO_MODULES = {
    # ==========================================================================
    # CHAPTER 1: THE STUDY OF LIFE
    # ==========================================================================
    "biology": ["m62717", "m62718"],
    "science": ["m62717"],
    "scientific method": ["m62717"],
    "hypothesis": ["m62717"],
    "theory": ["m62717"],
    "life": ["m62718"],
    "living things": ["m62718"],
    "characteristics of life": ["m62718"],
    # ==========================================================================
    # CHAPTER 2: THE CHEMICAL FOUNDATION OF LIFE
    # ==========================================================================
    "atom": ["m62720"],
    "atoms": ["m62720"],
    "element": ["m62720"],
    "elements": ["m62720"],
    "isotope": ["m62720"],
    "isotopes": ["m62720"],
    "ion": ["m62720"],
    "ions": ["m62720"],
    "molecule": ["m62720"],
    "molecules": ["m62720"],
    "chemical bond": ["m62720"],
    "covalent bond": ["m62720"],
    "ionic bond": ["m62720"],
    "hydrogen bond": ["m62721"],
    "water": ["m62721"],
    "polarity": ["m62721"],
    "cohesion": ["m62721"],
    "adhesion": ["m62721"],
    "solvent": ["m62721"],
    "ph": ["m62721"],
    "acid": ["m62721"],
    "base": ["m62721"],
    "buffer": ["m62721"],
    "carbon": ["m62722"],
    "organic": ["m62722"],
    "organic molecule": ["m62722"],
    "hydrocarbon": ["m62722"],
    "functional group": ["m62722"],
    # ==========================================================================
    # CHAPTER 3: BIOLOGICAL MACROMOLECULES
    # ==========================================================================
    "macromolecule": ["m62724", "m62726", "m62730", "m62733", "m62735"],
    "macromolecules": ["m62724", "m62726", "m62730", "m62733", "m62735"],
    "polymer": ["m62724"],
    "monomer": ["m62724"],
    "dehydration synthesis": ["m62724"],
    "hydrolysis": ["m62724", "m62768"],
    "carbohydrate": ["m62726"],
    "carbohydrates": ["m62726"],
    "sugar": ["m62726"],
    "sugars": ["m62726"],
    "glucose": ["m62726", "m62787"],
    "monosaccharide": ["m62726"],
    "disaccharide": ["m62726"],
    "polysaccharide": ["m62726"],
    "starch": ["m62726"],
    "glycogen": ["m62726"],
    "cellulose": ["m62726"],
    "lipid": ["m62730"],
    "lipids": ["m62730"],
    "fat": ["m62730"],
    "fats": ["m62730"],
    "fatty acid": ["m62730"],
    "triglyceride": ["m62730"],
    "phospholipid": ["m62730", "m62773"],
    "steroid": ["m62730"],
    "cholesterol": ["m62730"],
    "protein": ["m62733", "m62843"],
    "proteins": ["m62733", "m62843"],
    "amino acid": ["m62733"],
    "amino acids": ["m62733"],
    "peptide": ["m62733"],
    "peptide bond": ["m62733"],
    "polypeptide": ["m62733"],
    "protein structure": ["m62733"],
    "primary structure": ["m62733"],
    "secondary structure": ["m62733"],
    "tertiary structure": ["m62733"],
    "quaternary structure": ["m62733"],
    "nucleic acid": ["m62735"],
    "nucleic acids": ["m62735"],
    "nucleotide": ["m62735"],
    "nucleotides": ["m62735"],
    # ==========================================================================
    # CHAPTER 4: CELL STRUCTURE
    # ==========================================================================
    "cell": ["m62738", "m62740", "m62742"],
    "cells": ["m62738", "m62740", "m62742"],
    "cell theory": ["m62738"],
    "microscope": ["m62738"],
    "prokaryote": ["m62740", "m62891"],
    "prokaryotes": ["m62740", "m62891"],
    "prokaryotic": ["m62740", "m62808", "m62891"],
    "prokaryotic cell": ["m62740"],
    "eukaryote": ["m62742"],
    "eukaryotes": ["m62742"],
    "eukaryotic": ["m62742", "m62829"],
    "eukaryotic cell": ["m62742"],
    "organelle": ["m62742", "m62743"],
    "organelles": ["m62742", "m62743"],
    "nucleus": ["m62742"],
    "nucleolus": ["m62742"],
    "ribosome": ["m62742", "m62843"],
    "ribosomes": ["m62742", "m62843"],
    "mitochondria": ["m62742", "m62789"],
    "mitochondrion": ["m62742", "m62789"],
    "chloroplast": ["m62742", "m62794"],
    "chloroplasts": ["m62742", "m62794"],
    "endoplasmic reticulum": ["m62743"],
    "rough er": ["m62743"],
    "smooth er": ["m62743"],
    "golgi apparatus": ["m62743"],
    "golgi": ["m62743"],
    "lysosome": ["m62743"],
    "lysosomes": ["m62743"],
    "vacuole": ["m62743"],
    "peroxisome": ["m62743"],
    "endomembrane system": ["m62743"],
    "endomembrane": ["m62743"],
    "cytoskeleton": ["m62744"],
    "microtubule": ["m62744"],
    "microfilament": ["m62744"],
    "intermediate filament": ["m62744"],
    "cilia": ["m62744"],
    "flagella": ["m62744"],
    "cell wall": ["m62746"],
    "extracellular matrix": ["m62746"],
    "cell junction": ["m62746"],
    "tight junction": ["m62746"],
    "gap junction": ["m62746"],
    "plasmodesmata": ["m62746"],
    # ==========================================================================
    # CHAPTER 5: STRUCTURE AND FUNCTION OF PLASMA MEMBRANES
    # ==========================================================================
    "membrane": ["m62773", "m62753", "m62770"],
    "plasma membrane": ["m62773"],
    "cell membrane": ["m62773"],
    "fluid mosaic model": ["m62773"],
    "membrane protein": ["m62773"],
    "transport": ["m62753", "m62770", "m62772"],
    "passive transport": ["m62753"],
    "active transport": ["m62770"],
    "diffusion": ["m62753"],
    "facilitated diffusion": ["m62753"],
    "osmosis": ["m62753", "m63000"],
    "tonicity": ["m62753"],
    "hypertonic": ["m62753"],
    "hypotonic": ["m62753"],
    "isotonic": ["m62753"],
    "sodium potassium pump": ["m62770"],
    "electrochemical gradient": ["m62770"],
    "endocytosis": ["m62772"],
    "exocytosis": ["m62772"],
    "phagocytosis": ["m62772"],
    "pinocytosis": ["m62772"],
    "bulk transport": ["m62772"],
    # ==========================================================================
    # CHAPTER 6: METABOLISM
    # ==========================================================================
    "metabolism": ["m62763", "m62778", "m62761"],
    "metabolic": ["m62763"],
    "energy": ["m62763", "m62768", "m62764", "m62786"],
    "potential energy": ["m62764"],
    "kinetic energy": ["m62764"],
    "free energy": ["m62764"],
    "gibbs free energy": ["m62764"],
    "activation energy": ["m62764"],
    "exergonic": ["m62764"],
    "endergonic": ["m62764"],
    "thermodynamics": ["m62767"],
    "first law of thermodynamics": ["m62767"],
    "second law of thermodynamics": ["m62767"],
    "entropy": ["m62767"],
    "atp": ["m62768", "m62763", "m62786"],
    "adenosine triphosphate": ["m62768"],
    "adp": ["m62768"],
    "phosphorylation": ["m62768", "m62789"],
    "enzyme": ["m62778"],
    "enzymes": ["m62778"],
    "catalyst": ["m62778"],
    "active site": ["m62778"],
    "substrate": ["m62778"],
    "cofactor": ["m62778"],
    "coenzyme": ["m62778"],
    "inhibitor": ["m62778"],
    "competitive inhibition": ["m62778"],
    "noncompetitive inhibition": ["m62778"],
    "allosteric": ["m62778"],
    "feedback inhibition": ["m62778"],
    # ==========================================================================
    # CHAPTER 7: CELLULAR RESPIRATION
    # ==========================================================================
    "cellular respiration": ["m62786", "m62787", "m62788", "m62789"],
    "respiration": ["m62786", "m62787", "m62788", "m62789"],
    "aerobic respiration": ["m62786", "m62789"],
    "glycolysis": ["m62787"],
    "pyruvate": ["m62787", "m62788"],
    "citric acid cycle": ["m62788"],
    "citric acid": ["m62788"],
    "krebs cycle": ["m62788"],
    "krebs": ["m62788"],
    "tca cycle": ["m62788"],
    "tca": ["m62788"],
    "acetyl coa": ["m62788"],
    "nadh": ["m62788", "m62789"],
    "fadh2": ["m62788", "m62789"],
    "electron transport chain": ["m62789"],
    "electron transport": ["m62789"],
    "oxidative phosphorylation": ["m62789"],
    "chemiosmosis": ["m62789"],
    "atp synthase": ["m62789"],
    "fermentation": ["m62790"],
    "anaerobic": ["m62790"],
    "anaerobic respiration": ["m62790"],
    "lactic acid fermentation": ["m62790"],
    "alcohol fermentation": ["m62790"],
    # ==========================================================================
    # CHAPTER 8: PHOTOSYNTHESIS
    # ==========================================================================
    "photosynthesis": ["m62794", "m62795", "m62796"],
    "chlorophyll": ["m62794", "m62795"],
    "pigment": ["m62794"],
    "light reaction": ["m62795"],
    "light reactions": ["m62795"],
    "light dependent reactions": ["m62795"],
    "photosystem": ["m62795"],
    "photosystem i": ["m62795"],
    "photosystem ii": ["m62795"],
    "calvin cycle": ["m62796"],
    "light independent reactions": ["m62796"],
    "carbon fixation": ["m62796"],
    "rubisco": ["m62796"],
    "c3 plant": ["m62796"],
    "c4 plant": ["m62796"],
    "cam plant": ["m62796"],
    # ==========================================================================
    # CHAPTER 9: CELL COMMUNICATION
    # ==========================================================================
    "cell signaling": ["m62798", "m62799", "m62800"],
    "cell communication": ["m62798", "m62799"],
    "signal transduction": ["m62799"],
    "signaling molecule": ["m62798"],
    "ligand": ["m62798"],
    "receptor": ["m62798"],
    "receptor protein": ["m62798"],
    "g protein": ["m62799"],
    "second messenger": ["m62799"],
    "camp": ["m62799"],
    "signal cascade": ["m62799"],
    "kinase": ["m62799"],
    "phosphatase": ["m62799"],
    "apoptosis": ["m62800"],
    "programmed cell death": ["m62800"],
    # ==========================================================================
    # CHAPTER 10: CELL REPRODUCTION
    # ==========================================================================
    "cell division": ["m62803"],
    "cell cycle": ["m62804", "m62805"],
    "interphase": ["m62804"],
    "mitosis": ["m62803", "m62804"],
    "mitotic phase": ["m62803"],
    "prophase": ["m62803"],
    "metaphase": ["m62803"],
    "anaphase": ["m62803"],
    "telophase": ["m62803"],
    "cytokinesis": ["m62803"],
    "cell plate": ["m62803"],
    "cleavage furrow": ["m62803"],
    "spindle": ["m62803"],
    "centrosome": ["m62803"],
    "centriole": ["m62803"],
    "checkpoint": ["m62805"],
    "cyclin": ["m62805"],
    "cdk": ["m62805"],
    "cancer": ["m62806", "m62851"],
    "tumor": ["m62806"],
    "oncogene": ["m62806"],
    "tumor suppressor": ["m62806"],
    "p53": ["m62806"],
    "binary fission": ["m62808"],
    # ==========================================================================
    # CHAPTER 11: MEIOSIS AND SEXUAL REPRODUCTION
    # ==========================================================================
    "meiosis": ["m62810"],
    "meiosis i": ["m62810"],
    "meiosis ii": ["m62810"],
    "homologous chromosomes": ["m62810"],
    "crossing over": ["m62810"],
    "recombination": ["m62810"],
    "synapsis": ["m62810"],
    "tetrad": ["m62810"],
    "chiasma": ["m62810"],
    "independent assortment": ["m62810"],
    "haploid": ["m62810", "m62811"],
    "diploid": ["m62810", "m62811"],
    "gamete": ["m62811"],
    "gametes": ["m62811"],
    "sexual reproduction": ["m62811"],
    "asexual reproduction": ["m62811"],
    "genetic variation": ["m62811"],
    # ==========================================================================
    # CHAPTER 12: MENDEL'S EXPERIMENTS AND HEREDITY
    # ==========================================================================
    "mendel": ["m62813"],
    "mendelian genetics": ["m62813"],
    "heredity": ["m62819", "m62813"],
    "inheritance": ["m62819"],
    "trait": ["m62817"],
    "traits": ["m62817"],
    "allele": ["m62817", "m62819"],
    "alleles": ["m62817", "m62819"],
    "dominant": ["m62817"],
    "recessive": ["m62817"],
    "genotype": ["m62817"],
    "phenotype": ["m62817"],
    "homozygous": ["m62817"],
    "heterozygous": ["m62817"],
    "punnett square": ["m62813"],
    "law of segregation": ["m62819"],
    "law of independent assortment": ["m62819"],
    "monohybrid cross": ["m62813"],
    "dihybrid cross": ["m62819"],
    "test cross": ["m62813"],
    # ==========================================================================
    # CHAPTER 13: MODERN UNDERSTANDINGS OF INHERITANCE
    # ==========================================================================
    "chromosome": ["m62821", "m62822"],
    "chromosomes": ["m62821", "m62822"],
    "chromosomal theory": ["m62821"],
    "linked genes": ["m62821"],
    "linkage": ["m62821"],
    "sex linkage": ["m62821"],
    "x linked": ["m62821"],
    "y linked": ["m62821"],
    "sex chromosome": ["m62821"],
    "autosome": ["m62821"],
    "chromosomal disorder": ["m62822"],
    "nondisjunction": ["m62822"],
    "aneuploidy": ["m62822"],
    "polyploidy": ["m62822"],
    "down syndrome": ["m62822"],
    "trisomy": ["m62822"],
    "monosomy": ["m62822"],
    "deletion": ["m62822"],
    "duplication": ["m62822"],
    "inversion": ["m62822"],
    "translocation": ["m62822"],
    # ==========================================================================
    # CHAPTER 14: DNA STRUCTURE AND FUNCTION
    # ==========================================================================
    "dna": ["m62825", "m62826", "m62828", "m62829"],
    "deoxyribonucleic acid": ["m62825"],
    "double helix": ["m62825"],
    "watson and crick": ["m62824"],
    "chargaff": ["m62824"],
    "base pair": ["m62825"],
    "complementary base pairing": ["m62825"],
    "adenine": ["m62825"],
    "thymine": ["m62825"],
    "guanine": ["m62825"],
    "cytosine": ["m62825"],
    "dna replication": ["m62826", "m62828", "m62829"],
    "semiconservative replication": ["m62826"],
    "origin of replication": ["m62826"],
    "replication fork": ["m62826"],
    "helicase": ["m62826"],
    "dna polymerase": ["m62826", "m62828"],
    "primase": ["m62826"],
    "ligase": ["m62826"],
    "leading strand": ["m62826"],
    "lagging strand": ["m62826"],
    "okazaki fragment": ["m62826"],
    "telomere": ["m62829"],
    "telomerase": ["m62829"],
    "dna repair": ["m62830"],
    "mismatch repair": ["m62830"],
    "mutation": ["m62830"],
    # ==========================================================================
    # CHAPTER 15: GENES AND PROTEINS
    # ==========================================================================
    "genetic code": ["m62837"],
    "codon": ["m62837"],
    "anticodon": ["m62837"],
    "start codon": ["m62837"],
    "stop codon": ["m62837"],
    "central dogma": ["m62837"],
    "transcription": ["m62838", "m62840"],
    "rna polymerase": ["m62838", "m62840"],
    "promoter": ["m62838", "m62840"],
    "terminator": ["m62838"],
    "mrna": ["m62838", "m62842"],
    "messenger rna": ["m62838", "m62842"],
    "rna": ["m62842", "m62735"],
    "rna processing": ["m62842"],
    "splicing": ["m62842"],
    "intron": ["m62842"],
    "exon": ["m62842"],
    "5 cap": ["m62842"],
    "poly a tail": ["m62842"],
    "translation": ["m62843"],
    "protein synthesis": ["m62843"],
    "trna": ["m62843"],
    "transfer rna": ["m62843"],
    "rrna": ["m62843"],
    "ribosomal rna": ["m62843"],
    # ==========================================================================
    # CHAPTER 16: GENE EXPRESSION
    # ==========================================================================
    "gene": ["m62845", "m62837"],
    "genes": ["m62845", "m62837"],
    "gene expression": ["m62845"],
    "gene regulation": ["m62845", "m62846", "m62847"],
    "operon": ["m62846"],
    "lac operon": ["m62846"],
    "trp operon": ["m62846"],
    "repressor": ["m62846"],
    "inducer": ["m62846"],
    "epigenetics": ["m62847"],
    "epigenetic": ["m62847"],
    "dna methylation": ["m62847"],
    "histone modification": ["m62847"],
    "chromatin": ["m62847"],
    "transcription factor": ["m62848"],
    "enhancer": ["m62848"],
    "silencer": ["m62848"],
    "alternative splicing": ["m62849"],
    "microrna": ["m62849"],
    "sirna": ["m62849"],
    "rna interference": ["m62849"],
    # ==========================================================================
    # CHAPTER 17: BIOTECHNOLOGY AND GENOMICS
    # ==========================================================================
    "biotechnology": ["m62853"],
    "genetic engineering": ["m62853"],
    "recombinant dna": ["m62853"],
    "restriction enzyme": ["m62853"],
    "plasmid": ["m62853"],
    "vector": ["m62853"],
    "transformation": ["m62853"],
    "pcr": ["m62853"],
    "polymerase chain reaction": ["m62853"],
    "gel electrophoresis": ["m62853"],
    "cloning": ["m62853"],
    "transgenic": ["m62853"],
    "gmo": ["m62853"],
    "crispr": ["m62853"],
    "gene therapy": ["m62853"],
    "genome": ["m62855", "m62857"],
    "genomics": ["m62860", "m62861"],
    "genome mapping": ["m62855"],
    "physical map": ["m62855"],
    "genetic map": ["m62855"],
    "sequencing": ["m62857"],
    "whole genome sequencing": ["m62857"],
    "human genome project": ["m62857"],
    "proteomics": ["m62861"],
    "bioinformatics": ["m62860"],
    # ==========================================================================
    # CHAPTER 18: EVOLUTION AND THE ORIGIN OF SPECIES
    # ==========================================================================
    "evolution": ["m62863", "m62868"],
    "darwin": ["m62863"],
    "natural selection": ["m62871", "m63029"],
    "descent with modification": ["m62863"],
    "common ancestor": ["m62863"],
    "adaptation": ["m62871"],
    "fitness": ["m62871"],
    "speciation": ["m62864"],
    "species": ["m62864"],
    "reproductive isolation": ["m62864"],
    "prezygotic barrier": ["m62864"],
    "postzygotic barrier": ["m62864"],
    "allopatric speciation": ["m62864"],
    "sympatric speciation": ["m62864"],
    "adaptive radiation": ["m62865"],
    "convergent evolution": ["m62865"],
    "divergent evolution": ["m62865"],
    "coevolution": ["m62865"],
    # ==========================================================================
    # CHAPTER 19: THE EVOLUTION OF POPULATIONS
    # ==========================================================================
    "population genetics": ["m62870"],
    "gene pool": ["m62870"],
    "allele frequency": ["m62870"],
    "hardy weinberg": ["m62870"],
    "hardy weinberg equilibrium": ["m62870"],
    "genetic drift": ["m62868"],
    "bottleneck effect": ["m62868"],
    "founder effect": ["m62868"],
    "gene flow": ["m62868"],
    "mutation": ["m62868", "m62830"],
    "nonrandom mating": ["m62868"],
    "sexual selection": ["m62871"],
    "directional selection": ["m62871"],
    "stabilizing selection": ["m62871"],
    "disruptive selection": ["m62871"],
    "balancing selection": ["m62871"],
    # ==========================================================================
    # CHAPTER 20: PHYLOGENIES AND THE HISTORY OF LIFE
    # ==========================================================================
    "phylogeny": ["m62874", "m62903"],
    "phylogenetic tree": ["m62874", "m62903"],
    "cladogram": ["m62903"],
    "taxonomy": ["m62874"],
    "classification": ["m62874"],
    "binomial nomenclature": ["m62874"],
    "domain": ["m62874"],
    "kingdom": ["m62874"],
    "phylum": ["m62874"],
    "class": ["m62874"],
    "order": ["m62874"],
    "family": ["m62874"],
    "genus": ["m62874"],
    "clade": ["m62903"],
    "monophyletic": ["m62903"],
    "homology": ["m62903"],
    "analogy": ["m62903"],
    "molecular clock": ["m62903"],
    # ==========================================================================
    # CHAPTER 21: VIRUSES
    # ==========================================================================
    "virus": ["m62881", "m62882", "m62904"],
    "viruses": ["m62881", "m62882", "m62904"],
    "viral": ["m62881", "m62882"],
    "capsid": ["m62881"],
    "viral envelope": ["m62881"],
    "bacteriophage": ["m62881"],
    "lytic cycle": ["m62882"],
    "lysogenic cycle": ["m62882"],
    "retrovirus": ["m62882"],
    "reverse transcriptase": ["m62882"],
    "hiv": ["m62882"],
    "aids": ["m62882"],
    "vaccine": ["m62904"],
    "vaccination": ["m62904"],
    "antiviral": ["m62904"],
    "prion": ["m62887"],
    "viroid": ["m62887"],
    # ==========================================================================
    # CHAPTER 22: PROKARYOTES: BACTERIA AND ARCHAEA
    # ==========================================================================
    "bacteria": ["m62891", "m62893", "m62896"],
    "bacterial": ["m62891", "m62893", "m62896"],
    "archaea": ["m62891"],
    "prokaryotic diversity": ["m62891"],
    "bacterial structure": ["m62893"],
    "peptidoglycan": ["m62893"],
    "gram positive": ["m62893"],
    "gram negative": ["m62893"],
    "bacterial metabolism": ["m62894"],
    "nitrogen fixation": ["m62894"],
    "bioremediation": ["m62897"],
    "pathogen": ["m62896"],
    "bacterial disease": ["m62896"],
    "antibiotic": ["m62896"],
    "antibiotic resistance": ["m62896"],
    # ==========================================================================
    # CHAPTER 23: PLANT FORM AND PHYSIOLOGY
    # ==========================================================================
    "plant": ["m62951", "m62905", "m62906", "m62908"],
    "plants": ["m62951", "m62905", "m62906", "m62908"],
    "plant body": ["m62951"],
    "root": ["m62906"],
    "roots": ["m62906"],
    "root system": ["m62906"],
    "stem": ["m62905"],
    "stems": ["m62905"],
    "shoot system": ["m62905"],
    "leaf": ["m62908"],
    "leaves": ["m62908"],
    "vascular tissue": ["m62969"],
    "xylem": ["m62969"],
    "phloem": ["m62969"],
    "transpiration": ["m62969"],
    "stomata": ["m62908"],
    "guard cell": ["m62908"],
    "meristem": ["m62951"],
    "apical meristem": ["m62951"],
    "lateral meristem": ["m62951"],
    "dermal tissue": ["m62951"],
    "ground tissue": ["m62951"],
    "plant hormone": ["m62930"],
    "auxin": ["m62930"],
    "gibberellin": ["m62930"],
    "cytokinin": ["m62930"],
    "tropism": ["m62930"],
    "phototropism": ["m62930"],
    "gravitropism": ["m62930"],
    "photoperiodism": ["m62930"],
    # ==========================================================================
    # CHAPTER 24: THE ANIMAL BODY
    # ==========================================================================
    "animal": ["m62916", "m62918"],
    "animal body": ["m62916"],
    "body plan": ["m62916"],
    "tissue": ["m62918"],
    "tissues": ["m62918"],
    "epithelial tissue": ["m62918"],
    "connective tissue": ["m62918"],
    "muscle tissue": ["m62918"],
    "nervous tissue": ["m62918"],
    "organ": ["m62916"],
    "organ system": ["m62916"],
    "homeostasis": ["m62931"],
    "negative feedback": ["m62931"],
    "positive feedback": ["m62931"],
    "thermoregulation": ["m62931"],
    # ==========================================================================
    # CHAPTER 25: NUTRITION AND THE DIGESTIVE SYSTEM
    # ==========================================================================
    "digestive system": ["m62919", "m62921", "m62922"],
    "digestive": ["m62919", "m62921"],
    "digestion": ["m62919", "m62921"],
    "nutrition": ["m62920"],
    "nutrient": ["m62920"],
    "nutrients": ["m62920"],
    "vitamin": ["m62920"],
    "mineral": ["m62920"],
    "mouth": ["m62921"],
    "esophagus": ["m62921"],
    "stomach": ["m62921"],
    "small intestine": ["m62921"],
    "large intestine": ["m62921"],
    "intestine": ["m62921"],
    "liver": ["m62921"],
    "pancreas": ["m62921", "m62995", "m62996"],
    "gallbladder": ["m62921"],
    "enzyme": ["m62921", "m62778"],
    "peristalsis": ["m62921"],
    "absorption": ["m62921"],
    "villi": ["m62921"],
    # ==========================================================================
    # CHAPTER 26: THE NERVOUS SYSTEM
    # ==========================================================================
    "nervous system": ["m62924", "m62925", "m62926", "m62928"],
    "neuron": ["m62924", "m62925"],
    "neurons": ["m62924", "m62925"],
    "nerve": ["m62924"],
    "nerves": ["m62924"],
    "glial cell": ["m62924"],
    "dendrite": ["m62924"],
    "axon": ["m62924"],
    "myelin": ["m62924"],
    "synapse": ["m62925"],
    "neurotransmitter": ["m62925"],
    "action potential": ["m62925"],
    "resting potential": ["m62925"],
    "depolarization": ["m62925"],
    "repolarization": ["m62925"],
    "brain": ["m62926"],
    "cerebrum": ["m62926"],
    "cerebellum": ["m62926"],
    "brainstem": ["m62926"],
    "spinal cord": ["m62926"],
    "central nervous system": ["m62926"],
    "cns": ["m62926"],
    "peripheral nervous system": ["m62928"],
    "pns": ["m62928"],
    "autonomic nervous system": ["m62928"],
    "sympathetic": ["m62928"],
    "parasympathetic": ["m62928"],
    "somatic nervous system": ["m62928"],
    "reflex": ["m62928"],
    # ==========================================================================
    # CHAPTER 27: SENSORY SYSTEMS
    # ==========================================================================
    "sensory": ["m62994", "m62946", "m62957"],
    "sensory system": ["m62994"],
    "sensory receptor": ["m62994"],
    "sensation": ["m62994"],
    "perception": ["m62994"],
    "somatosensation": ["m62946"],
    "touch": ["m62946"],
    "pain": ["m62946"],
    "proprioception": ["m62946"],
    "taste": ["m62947"],
    "gustation": ["m62947"],
    "smell": ["m62947"],
    "olfaction": ["m62947"],
    "hearing": ["m62954"],
    "ear": ["m62954"],
    "cochlea": ["m62954"],
    "vestibular": ["m62954"],
    "balance": ["m62954"],
    "vision": ["m62957"],
    "eye": ["m62957"],
    "retina": ["m62957"],
    "rod": ["m62957"],
    "cone": ["m62957"],
    "lens": ["m62957"],
    "cornea": ["m62957"],
    "photoreceptor": ["m62957"],
    # ==========================================================================
    # CHAPTER 28: THE ENDOCRINE SYSTEM
    # ==========================================================================
    "endocrine": ["m62961", "m62963", "m62995", "m62996", "m62971"],
    "endocrine system": ["m62961", "m62963", "m62995", "m62996", "m62971"],
    "hormone": ["m62961", "m62963", "m62971", "m62996"],
    "hormones": ["m62961", "m62963", "m62971", "m62996"],
    "gland": ["m62995"],
    "glands": ["m62995"],
    "endocrine gland": ["m62995"],
    "exocrine gland": ["m62995"],
    "pituitary": ["m62995", "m62971"],
    "pituitary gland": ["m62995", "m62971"],
    "hypothalamus": ["m62971", "m62995"],
    "thyroid": ["m62995", "m62996"],
    "thyroid gland": ["m62995"],
    "parathyroid": ["m62995"],
    "adrenal": ["m62995"],
    "adrenal gland": ["m62995"],
    "cortisol": ["m62995"],
    "adrenaline": ["m62995"],
    "epinephrine": ["m62995"],
    "insulin": ["m62996", "m62995"],
    "glucagon": ["m62996"],
    "diabetes": ["m62996"],
    "growth hormone": ["m62971"],
    "testosterone": ["m62995"],
    "estrogen": ["m62995"],
    "progesterone": ["m62995"],
    "feedback loop": ["m62971"],
    # ==========================================================================
    # CHAPTER 29: THE MUSCULOSKELETAL SYSTEM
    # ==========================================================================
    "musculoskeletal": ["m62977", "m62978", "m62980"],
    "skeletal system": ["m62977", "m62978"],
    "skeleton": ["m62977"],
    "bone": ["m62978"],
    "bones": ["m62978"],
    "cartilage": ["m62978"],
    "joint": ["m62979"],
    "joints": ["m62979"],
    "ligament": ["m62979"],
    "tendon": ["m62979"],
    "muscle": ["m62980"],
    "muscles": ["m62980"],
    "muscular system": ["m62980"],
    "skeletal muscle": ["m62980"],
    "smooth muscle": ["m62980"],
    "cardiac muscle": ["m62980"],
    "muscle contraction": ["m62980"],
    "sarcomere": ["m62980"],
    "actin": ["m62980"],
    "myosin": ["m62980"],
    "sliding filament": ["m62980"],
    # ==========================================================================
    # CHAPTER 30: THE RESPIRATORY SYSTEM
    # ==========================================================================
    "respiratory system": ["m62982", "m62987", "m62988"],
    "respiratory": ["m62982", "m62987"],
    "breathing": ["m62987"],
    "lung": ["m62982"],
    "lungs": ["m62982"],
    "gas exchange": ["m62982", "m62998"],
    "alveoli": ["m62982"],
    "alveolus": ["m62982"],
    "trachea": ["m62982"],
    "bronchi": ["m62982"],
    "bronchiole": ["m62982"],
    "diaphragm": ["m62987"],
    "inhalation": ["m62987"],
    "exhalation": ["m62987"],
    "ventilation": ["m62987"],
    "hemoglobin": ["m62988"],
    "oxygen transport": ["m62988"],
    "carbon dioxide transport": ["m62988"],
    # ==========================================================================
    # CHAPTER 31: THE CIRCULATORY SYSTEM
    # ==========================================================================
    "circulatory system": ["m62990", "m62991", "m62992", "m62993"],
    "circulatory": ["m62990", "m62992"],
    "cardiovascular": ["m62990", "m62992"],
    "heart": ["m62992"],
    "cardiac": ["m62992"],
    "blood": ["m62991", "m62993"],
    "blood vessel": ["m62992"],
    "artery": ["m62992"],
    "vein": ["m62992"],
    "capillary": ["m62992"],
    "red blood cell": ["m62991"],
    "white blood cell": ["m62991"],
    "platelet": ["m62991"],
    "plasma": ["m62991"],
    "blood pressure": ["m62993"],
    "pulse": ["m62993"],
    "systole": ["m62992"],
    "diastole": ["m62992"],
    "atrium": ["m62992"],
    "ventricle": ["m62992"],
    # ==========================================================================
    # CHAPTER 32: OSMOTIC REGULATION AND EXCRETION
    # ==========================================================================
    "osmoregulation": ["m63000", "m63004"],
    "excretion": ["m63002"],
    "excretory system": ["m63002"],
    "kidney": ["m63001"],
    "kidneys": ["m63001"],
    "nephron": ["m63001"],
    "glomerulus": ["m63001"],
    "filtration": ["m63001"],
    "reabsorption": ["m63001"],
    "secretion": ["m63001"],
    "urine": ["m63001"],
    "urinary system": ["m63001"],
    "bladder": ["m63001"],
    "urea": ["m63003"],
    "uric acid": ["m63003"],
    "ammonia": ["m63003"],
    "nitrogenous waste": ["m63003"],
    "antidiuretic hormone": ["m63004"],
    "adh": ["m63004"],
    "aldosterone": ["m63004"],
    # ==========================================================================
    # CHAPTER 33: THE IMMUNE SYSTEM
    # ==========================================================================
    "immune system": ["m63006", "m63007", "m63008", "m63009"],
    "immune": ["m63006", "m63007"],
    "immunity": ["m63006", "m63007"],
    "innate immunity": ["m63006"],
    "adaptive immunity": ["m63007"],
    "pathogen": ["m63006"],
    "antigen": ["m63007"],
    "antibody": ["m63008"],
    "antibodies": ["m63008"],
    "lymphocyte": ["m63007"],
    "t cell": ["m63007"],
    "b cell": ["m63007", "m63008"],
    "helper t cell": ["m63007"],
    "cytotoxic t cell": ["m63007"],
    "memory cell": ["m63007"],
    "mhc": ["m63007"],
    "inflammation": ["m63006"],
    "fever": ["m63006"],
    "phagocyte": ["m63006"],
    "macrophage": ["m63006"],
    "neutrophil": ["m63006"],
    "natural killer cell": ["m63006"],
    "complement": ["m63006"],
    "interferon": ["m63006"],
    "allergy": ["m63009"],
    "autoimmune": ["m63009"],
    "autoimmune disease": ["m63009"],
    "immunodeficiency": ["m63009"],
    # ==========================================================================
    # CHAPTER 34: ANIMAL REPRODUCTION AND DEVELOPMENT
    # ==========================================================================
    "reproduction": ["m63011", "m63013", "m63014"],
    "reproductive": ["m63011", "m63013", "m63014"],
    "reproductive system": ["m63013", "m63014", "m63018"],
    "asexual reproduction": ["m63011"],
    "sexual reproduction": ["m63011", "m62811"],
    "fertilization": ["m63012", "m63016"],
    "internal fertilization": ["m63012"],
    "external fertilization": ["m63012"],
    "gametogenesis": ["m63013"],
    "spermatogenesis": ["m63013"],
    "oogenesis": ["m63013"],
    "sperm": ["m63013"],
    "egg": ["m63013"],
    "ovum": ["m63013"],
    "testis": ["m63013"],
    "ovary": ["m63013"],
    "uterus": ["m63013"],
    "menstrual cycle": ["m63014"],
    "ovulation": ["m63014"],
    "pregnancy": ["m63018"],
    "embryo": ["m63016", "m63043"],
    "embryonic development": ["m63016"],
    "cleavage": ["m63016"],
    "blastula": ["m63016"],
    "gastrula": ["m63016"],
    "gastrulation": ["m63016"],
    "organogenesis": ["m63043"],
    "germ layer": ["m63043"],
    "ectoderm": ["m63043"],
    "mesoderm": ["m63043"],
    "endoderm": ["m63043"],
    "placenta": ["m63018"],
    "fetus": ["m63018"],
    "labor": ["m63018"],
    "birth": ["m63018"],
    # ==========================================================================
    # CHAPTER 35: ECOLOGY AND THE BIOSPHERE
    # ==========================================================================
    "ecology": ["m63021", "m63033", "m63036"],
    "biosphere": ["m63021"],
    "biogeography": ["m63023"],
    "biome": ["m63024", "m63025"],
    "biomes": ["m63024", "m63025"],
    "terrestrial biome": ["m63024"],
    "tropical rainforest": ["m63024"],
    "savanna": ["m63024"],
    "desert": ["m63024"],
    "chaparral": ["m63024"],
    "temperate grassland": ["m63024"],
    "temperate forest": ["m63024"],
    "boreal forest": ["m63024"],
    "taiga": ["m63024"],
    "tundra": ["m63024"],
    "aquatic biome": ["m63025"],
    "freshwater": ["m63025"],
    "marine": ["m63025"],
    "estuary": ["m63025"],
    "coral reef": ["m63025"],
    "climate": ["m63026"],
    "climate change": ["m63026"],
    "global warming": ["m63026"],
    "greenhouse effect": ["m63026"],
    "greenhouse gas": ["m63026"],
    # ==========================================================================
    # CHAPTER 36: POPULATION AND COMMUNITY ECOLOGY
    # ==========================================================================
    "population": ["m63028", "m63030", "m63031"],
    "population ecology": ["m63028"],
    "demography": ["m63028"],
    "population growth": ["m63032"],
    "exponential growth": ["m63030"],
    "logistic growth": ["m63030"],
    "carrying capacity": ["m63030"],
    "density dependent": ["m63031"],
    "density independent": ["m63031"],
    "life history": ["m63029"],
    "survivorship": ["m63028"],
    "age structure": ["m63028"],
    "human population": ["m63032"],
    "community": ["m63033"],
    "community ecology": ["m63033"],
    "species interaction": ["m63033"],
    "competition": ["m63033"],
    "predation": ["m63033"],
    "predator": ["m63033"],
    "prey": ["m63033"],
    "herbivory": ["m63033"],
    "symbiosis": ["m63033"],
    "mutualism": ["m63033"],
    "commensalism": ["m63033"],
    "parasitism": ["m63033"],
    "ecological succession": ["m63033"],
    "primary succession": ["m63033"],
    "secondary succession": ["m63033"],
    "keystone species": ["m63033"],
    "behavior": ["m63034"],
    "animal behavior": ["m63034"],
    "innate behavior": ["m63034"],
    "learned behavior": ["m63034"],
    # ==========================================================================
    # CHAPTER 37: ECOSYSTEMS
    # ==========================================================================
    "ecosystem": ["m63036", "m63037", "m63040"],
    "ecosystems": ["m63036", "m63037"],
    "energy flow": ["m63037"],
    "food chain": ["m63037"],
    "food web": ["m63037"],
    "trophic level": ["m63037"],
    "producer": ["m63037"],
    "consumer": ["m63037"],
    "primary consumer": ["m63037"],
    "secondary consumer": ["m63037"],
    "tertiary consumer": ["m63037"],
    "decomposer": ["m63037"],
    "detritivore": ["m63037"],
    "gross primary productivity": ["m63037"],
    "net primary productivity": ["m63037"],
    "biomass": ["m63037"],
    "energy pyramid": ["m63037"],
    "biogeochemical cycle": ["m63040"],
    "carbon cycle": ["m63040"],
    "nitrogen cycle": ["m63040"],
    "phosphorus cycle": ["m63040"],
    "water cycle": ["m63040"],
    "hydrologic cycle": ["m63040"],
    # ==========================================================================
    # CHAPTER 38: CONSERVATION BIOLOGY AND BIODIVERSITY
    # ==========================================================================
    "biodiversity": ["m63048", "m63049", "m63051"],
    "conservation": ["m63051"],
    "conservation biology": ["m63051"],
    "extinction": ["m63048"],
    "mass extinction": ["m63048"],
    "endangered species": ["m63048"],
    "threatened species": ["m63048"],
    "habitat loss": ["m63050"],
    "habitat fragmentation": ["m63050"],
    "deforestation": ["m63050"],
    "invasive species": ["m63050"],
    "overexploitation": ["m63050"],
    "pollution": ["m63050"],
    "ecosystem services": ["m63049"],
    "genetic diversity": ["m63049"],
    "species diversity": ["m63049"],
    "ecosystem diversity": ["m63049"],
    "preserve": ["m63051"],
    "wildlife corridor": ["m63051"],
    "sustainable": ["m63051"],
    "sustainability": ["m63051"],
}


def get_module_url(module_id: str) -> str:
  """
  Generate the OpenStax URL for a module.

  Uses the pre-computed chapter slug mapping for accurate URLs
  that match the actual OpenStax website structure.
  """
  # Use the chapter slug mapping for accurate URLs
  if module_id in MODULE_TO_CHAPTER_SLUG:
    slug = MODULE_TO_CHAPTER_SLUG[module_id]
    return f"{OPENSTAX_BASE_URL}/{slug}"

  # Fallback for modules not in mapping
  if module_id not in MODULE_INDEX:
    return f"{OPENSTAX_BASE_URL}/1-introduction"

  info = MODULE_INDEX[module_id]
  title = info["title"]

  # Generate slug from title as last resort
  slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")

  # For introduction pages, use chapter name
  if title == "Introduction":
    chapter = info["chapter"]
    slug = re.sub(r"[^a-z0-9]+", "-", chapter.lower()).strip("-")

  return f"{OPENSTAX_BASE_URL}/{slug}"


def search_modules(topic: str, max_results: int = 3) -> list[dict]:
  """
  Search for modules matching a topic using keyword matching.

  Args:
      topic: The search topic
      max_results: Maximum number of results to return

  Returns:
      List of module info dicts with id, title, unit, chapter, and url
  """
  import logging

  logger = logging.getLogger(__name__)

  logger.info("=" * 50)
  logger.info("SEARCH_MODULES CALLED")
  logger.info(f"Topic: '{topic}'")
  logger.info(f"Max results: {max_results}")
  logger.info("=" * 50)

  topic_lower = topic.lower()
  matched_ids = set()
  matched_keywords = []  # Track which keywords matched for debugging

  # First, check direct keyword matches using word boundaries
  # to avoid matching "stem" inside "system"
  for keyword, module_ids in KEYWORD_TO_MODULES.items():
    # Use word boundary matching for single-word keywords
    # For multi-word keywords, require exact substring match
    if " " in keyword:
      # Multi-word keyword - exact substring match is fine
      if keyword in topic_lower:
        matched_ids.update(module_ids)
        matched_keywords.append(keyword)
    else:
      # Single-word keyword - require word boundaries
      pattern = r"\b" + re.escape(keyword) + r"\b"
      if re.search(pattern, topic_lower):
        matched_ids.update(module_ids)
        matched_keywords.append(keyword)

  if matched_keywords:
    logger.info(f"KEYWORD MATCHES FOUND: {matched_keywords}")
    logger.info(
        "Matched module IDs:"
        f" {list(matched_ids)[:10]}{'...' if len(matched_ids) > 10 else ''}"
    )
  else:
    logger.info("No keyword matches found, falling back to title search...")

  # If no keyword matches, search titles
  if not matched_ids:
    for module_id, info in MODULE_INDEX.items():
      title_lower = info["title"].lower()
      chapter_lower = info["chapter"].lower()

      # Check if any word from topic is in title or chapter
      topic_words = set(re.findall(r"\b\w+\b", topic_lower))
      title_words = set(re.findall(r"\b\w+\b", title_lower))
      chapter_words = set(re.findall(r"\b\w+\b", chapter_lower))

      if topic_words & title_words or topic_words & chapter_words:
        matched_ids.add(module_id)

    if matched_ids:
      logger.info(f"Title search found {len(matched_ids)} modules")
    else:
      logger.warning(f"NO MATCHES FOUND for topic: '{topic}'")

  # Convert to result list
  results = []
  for mid in list(matched_ids)[:max_results]:
    if mid in MODULE_INDEX:
      info = MODULE_INDEX[mid]
      # Skip introduction modules unless specifically requested
      if info["title"] == "Introduction" and "introduction" not in topic_lower:
        continue
      results.append({
          "id": mid,
          "title": info["title"],
          "unit": info["unit"],
          "chapter": info["chapter"],
          "url": get_module_url(mid),
      })

  logger.info(f"Returning {len(results)} results: {[r['id'] for r in results]}")
  return results[:max_results]


def get_source_citation(module_ids: list[str]) -> dict:
  """
  Generate a source citation for a list of modules.

  Returns a dict with url, title, and provider for attribution.
  """
  if not module_ids:
    return {
        "url": OPENSTAX_BASE_URL,
        "title": "OpenStax Biology for AP Courses",
        "provider": "OpenStax",
    }

  # Use the first module for the citation
  mid = module_ids[0]
  if mid not in MODULE_INDEX:
    return {
        "url": OPENSTAX_BASE_URL,
        "title": "OpenStax Biology for AP Courses",
        "provider": "OpenStax",
    }

  info = MODULE_INDEX[mid]
  return {
      "url": get_module_url(mid),
      "title": f"{info['chapter']}: {info['title']}",
      "provider": "OpenStax Biology for AP Courses",
  }

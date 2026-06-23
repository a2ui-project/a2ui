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
Complete OpenStax Biology AP Courses Chapter Index

This module provides a comprehensive mapping of all chapters in the OpenStax
Biology for AP Courses textbook, along with topic-to-chapter matching.

Content is sourced from the OpenStax GitHub repository:
https://github.com/openstax/osbooks-biology-bundle

The module IDs (e.g., m62767) correspond to CNXML files in the modules/ directory.

NOTE ON KEYWORD MATCHING APPROACH:
-----------------------------------
The KEYWORD_HINTS dictionary below uses a simple keyword-based approach to map
user topics to textbook chapters. This is admittedly naive and could be improved
with more sophisticated techniques (semantic search, embeddings, etc.). However,
content retrieval is not the main focus of this A2UI demo - we're demonstrating
the agent-to-UI rendering pipeline, not building a production content system.
For a real application, consider using vector embeddings or a proper search index.
"""

# GitHub raw content base URL for fetching module content
GITHUB_RAW_BASE = (
    "https://raw.githubusercontent.com/openstax/osbooks-biology-bundle/main/modules"
)

# OpenStax website base URL for citations
OPENSTAX_WEB_BASE = "https://openstax.org/books/biology-ap-courses/pages"

# Complete chapter list with human-readable titles
OPENSTAX_CHAPTERS = {
    # Unit 1: The Chemistry of Life
    "1-1-the-science-of-biology": "The Science of Biology",
    "1-2-themes-and-concepts-of-biology": "Themes and Concepts of Biology",
    "2-1-atoms-isotopes-ions-and-molecules-the-building-blocks": (
        "Atoms, Isotopes, Ions, and Molecules: The Building Blocks"
    ),
    "2-2-water": "Water",
    "2-3-carbon": "Carbon",
    "3-1-synthesis-of-biological-macromolecules": (
        "Synthesis of Biological Macromolecules"
    ),
    "3-2-carbohydrates": "Carbohydrates",
    "3-3-lipids": "Lipids",
    "3-4-proteins": "Proteins",
    "3-5-nucleic-acids": "Nucleic Acids",
    # Unit 2: The Cell
    "4-1-studying-cells": "Studying Cells",
    "4-2-prokaryotic-cells": "Prokaryotic Cells",
    "4-3-eukaryotic-cells": "Eukaryotic Cells",
    "4-4-the-endomembrane-system-and-proteins": "The Endomembrane System and Proteins",
    "4-5-cytoskeleton": "Cytoskeleton",
    "4-6-connections-between-cells-and-cellular-activities": (
        "Connections Between Cells and Cellular Activities"
    ),
    "5-1-components-and-structure": "Cell Membrane Components and Structure",
    "5-2-passive-transport": "Passive Transport",
    "5-3-active-transport": "Active Transport",
    "5-4-bulk-transport": "Bulk Transport",
    "6-1-energy-and-metabolism": "Energy and Metabolism",
    "6-2-potential-kinetic-free-and-activation-energy": (
        "Potential, Kinetic, Free, and Activation Energy"
    ),
    "6-3-the-laws-of-thermodynamics": "The Laws of Thermodynamics",
    "6-4-atp-adenosine-triphosphate": "ATP: Adenosine Triphosphate",
    "6-5-enzymes": "Enzymes",
    "7-1-energy-in-living-systems": "Energy in Living Systems",
    "7-2-glycolysis": "Glycolysis",
    "7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle": (
        "Oxidation of Pyruvate and the Citric Acid Cycle"
    ),
    "7-4-oxidative-phosphorylation": "Oxidative Phosphorylation",
    "7-5-metabolism-without-oxygen": "Metabolism Without Oxygen",
    "7-6-connections-of-carbohydrate-protein-and-lipid-metabolic-pathways": (
        "Connections of Carbohydrate, Protein, and Lipid Metabolic Pathways"
    ),
    "7-7-regulation-of-cellular-respiration": "Regulation of Cellular Respiration",
    "8-1-overview-of-photosynthesis": "Overview of Photosynthesis",
    "8-2-the-light-dependent-reaction-of-photosynthesis": (
        "The Light-Dependent Reactions of Photosynthesis"
    ),
    "8-3-using-light-to-make-organic-molecules": (
        "Using Light to Make Organic Molecules"
    ),
    "9-1-signaling-molecules-and-cellular-receptors": (
        "Signaling Molecules and Cellular Receptors"
    ),
    "9-2-propagation-of-the-signal": "Propagation of the Signal",
    "9-3-response-to-the-signal": "Response to the Signal",
    "9-4-signaling-in-single-celled-organisms": "Signaling in Single-Celled Organisms",
    "10-1-cell-division": "Cell Division",
    "10-2-the-cell-cycle": "The Cell Cycle",
    "10-3-control-of-the-cell-cycle": "Control of the Cell Cycle",
    "10-4-cancer-and-the-cell-cycle": "Cancer and the Cell Cycle",
    "10-5-prokaryotic-cell-division": "Prokaryotic Cell Division",
    # Unit 3: Genetics
    "11-1-the-process-of-meiosis": "The Process of Meiosis",
    "11-2-sexual-reproduction": "Sexual Reproduction",
    "12-1-mendels-experiments-and-the-laws-of-probability": (
        "Mendel's Experiments and the Laws of Probability"
    ),
    "12-2-characteristics-and-traits": "Characteristics and Traits",
    "12-3-laws-of-inheritance": "Laws of Inheritance",
    "13-1-chromosomal-theory-and-genetic-linkages": (
        "Chromosomal Theory and Genetic Linkages"
    ),
    "13-2-chromosomal-basis-of-inherited-disorders": (
        "Chromosomal Basis of Inherited Disorders"
    ),
    "14-1-historical-basis-of-modern-understanding": (
        "Historical Basis of Modern Understanding of DNA"
    ),
    "14-2-dna-structure-and-sequencing": "DNA Structure and Sequencing",
    "14-3-basics-of-dna-replication": "Basics of DNA Replication",
    "14-4-dna-replication-in-prokaryotes": "DNA Replication in Prokaryotes",
    "14-5-dna-replication-in-eukaryotes": "DNA Replication in Eukaryotes",
    "14-6-dna-repair": "DNA Repair",
    "15-1-the-genetic-code": "The Genetic Code",
    "15-2-prokaryotic-transcription": "Prokaryotic Transcription",
    "15-3-eukaryotic-transcription": "Eukaryotic Transcription",
    "15-4-rna-processing-in-eukaryotes": "RNA Processing in Eukaryotes",
    "15-5-ribosomes-and-protein-synthesis": "Ribosomes and Protein Synthesis",
    "16-1-regulation-of-gene-expression": "Regulation of Gene Expression",
    "16-2-prokaryotic-gene-regulation": "Prokaryotic Gene Regulation",
    "16-3-eukaryotic-epigenetic-gene-regulation": (
        "Eukaryotic Epigenetic Gene Regulation"
    ),
    "16-4-eukaryotic-transcriptional-gene-regulation": (
        "Eukaryotic Transcriptional Gene Regulation"
    ),
    "16-5-eukaryotic-post-transcriptional-gene-regulation": (
        "Eukaryotic Post-transcriptional Gene Regulation"
    ),
    "16-6-eukaryotic-translational-and-post-translational-gene-regulation": (
        "Eukaryotic Translational and Post-translational Gene Regulation"
    ),
    "16-7-cancer-and-gene-regulation": "Cancer and Gene Regulation",
    "17-1-biotechnology": "Biotechnology",
    "17-2-mapping-genomes": "Mapping Genomes",
    "17-3-whole-genome-sequencing": "Whole-Genome Sequencing",
    "17-4-applying-genomics": "Applying Genomics",
    "17-5-genomics-and-proteomics": "Genomics and Proteomics",
    # Unit 4: Evolutionary Processes
    "18-1-understanding-evolution": "Understanding Evolution",
    "18-2-formation-of-new-species": "Formation of New Species",
    "18-3-reconnection-and-rates-of-speciation": "Reconnection and Rates of Speciation",
    "19-1-population-evolution": "Population Evolution",
    "19-2-population-genetics": "Population Genetics",
    "19-3-adaptive-evolution": "Adaptive Evolution",
    "20-1-organizing-life-on-earth": "Organizing Life on Earth",
    "20-2-determining-evolutionary-relationships": (
        "Determining Evolutionary Relationships"
    ),
    "20-3-perspectives-on-the-phylogenetic-tree": (
        "Perspectives on the Phylogenetic Tree"
    ),
    # Unit 5: Biological Diversity
    "21-1-viral-evolution-morphology-and-classification": (
        "Viral Evolution, Morphology, and Classification"
    ),
    "21-2-virus-infection-and-hosts": "Virus Infection and Hosts",
    "21-3-prevention-and-treatment-of-viral-infections": (
        "Prevention and Treatment of Viral Infections"
    ),
    "21-4-other-acellular-entities-prions-and-viroids": (
        "Other Acellular Entities: Prions and Viroids"
    ),
    "22-1-prokaryotic-diversity": "Prokaryotic Diversity",
    "22-2-structure-of-prokaryotes": "Structure of Prokaryotes",
    "22-3-prokaryotic-metabolism": "Prokaryotic Metabolism",
    "22-4-bacterial-diseases-in-humans": "Bacterial Diseases in Humans",
    "22-5-beneficial-prokaryotes": "Beneficial Prokaryotes",
    # Unit 6: Plant Structure and Function
    "23-1-the-plant-body": "The Plant Body",
    "23-2-stems": "Stems",
    "23-3-roots": "Roots",
    "23-4-leaves": "Leaves",
    "23-5-transport-of-water-and-solutes-in-plants": (
        "Transport of Water and Solutes in Plants"
    ),
    "23-6-plant-sensory-systems-and-responses": "Plant Sensory Systems and Responses",
    # Unit 7: Animal Structure and Function
    "24-1-animal-form-and-function": "Animal Form and Function",
    "24-2-animal-primary-tissues": "Animal Primary Tissues",
    "24-3-homeostasis": "Homeostasis",
    "25-1-digestive-systems": "Digestive Systems",
    "25-2-nutrition-and-energy-production": "Nutrition and Energy Production",
    "25-3-digestive-system-processes": "Digestive System Processes",
    "25-4-digestive-system-regulation": "Digestive System Regulation",
    "26-1-neurons-and-glial-cells": "Neurons and Glial Cells",
    "26-2-how-neurons-communicate": "How Neurons Communicate",
    "26-3-the-central-nervous-system": "The Central Nervous System",
    "26-4-the-peripheral-nervous-system": "The Peripheral Nervous System",
    "26-5-nervous-system-disorders": "Nervous System Disorders",
    "27-1-sensory-processes": "Sensory Processes",
    "27-2-somatosensation": "Somatosensation",
    "27-3-taste-and-smell": "Taste and Smell",
    "27-4-hearing-and-vestibular-sensation": "Hearing and Vestibular Sensation",
    "27-5-vision": "Vision",
    "28-1-types-of-hormones": "Types of Hormones",
    "28-2-how-hormones-work": "How Hormones Work",
    "28-3-regulation-of-body-processes": "Regulation of Body Processes",
    "28-4-regulation-of-hormone-production": "Regulation of Hormone Production",
    "28-5-endocrine-glands": "Endocrine Glands",
    "29-1-types-of-skeletal-systems": "Types of Skeletal Systems",
    "29-2-bone": "Bone",
    "29-3-joints-and-skeletal-movement": "Joints and Skeletal Movement",
    "29-4-muscle-contraction-and-locomotion": "Muscle Contraction and Locomotion",
    "30-1-systems-of-gas-exchange": "Systems of Gas Exchange",
    "30-2-gas-exchange-across-respiratory-surfaces": (
        "Gas Exchange Across Respiratory Surfaces"
    ),
    "30-3-breathing": "Breathing",
    "30-4-transport-of-gases-in-human-bodily-fluids": (
        "Transport of Gases in Human Bodily Fluids"
    ),
    "31-1-overview-of-the-circulatory-system": "Overview of the Circulatory System",
    "31-2-components-of-the-blood": "Components of the Blood",
    "31-3-mammalian-heart-and-blood-vessels": "Mammalian Heart and Blood Vessels",
    "31-4-blood-flow-and-blood-pressure-regulation": (
        "Blood Flow and Blood Pressure Regulation"
    ),
    "32-1-osmoregulation-and-osmotic-balance": "Osmoregulation and Osmotic Balance",
    "32-2-the-kidneys-and-osmoregulatory-organs": (
        "The Kidneys and Osmoregulatory Organs"
    ),
    "32-3-excretion-systems": "Excretion Systems",
    "32-4-nitrogenous-wastes": "Nitrogenous Wastes",
    "32-5-hormonal-control-of-osmoregulatory-functions": (
        "Hormonal Control of Osmoregulatory Functions"
    ),
    "33-1-innate-immune-response": "Innate Immune Response",
    "33-2-adaptive-immune-response": "Adaptive Immune Response",
    "33-3-antibodies": "Antibodies",
    "33-4-disruptions-in-the-immune-system": "Disruptions in the Immune System",
    "34-1-reproduction-methods": "Reproduction Methods",
    "34-2-fertilization": "Fertilization",
    "34-3-human-reproductive-anatomy-and-gametogenesis": (
        "Human Reproductive Anatomy and Gametogenesis"
    ),
    "34-4-hormonal-control-of-human-reproduction": (
        "Hormonal Control of Human Reproduction"
    ),
    "34-5-fertilization-and-early-embryonic-development": (
        "Fertilization and Early Embryonic Development"
    ),
    "34-6-organogenesis-and-vertebrate-axis-formation": (
        "Organogenesis and Vertebrate Axis Formation"
    ),
    "34-7-human-pregnancy-and-birth": "Human Pregnancy and Birth",
    # Unit 8: Ecology
    "35-1-the-scope-of-ecology": "The Scope of Ecology",
    "35-2-biogeography": "Biogeography",
    "35-3-terrestrial-biomes": "Terrestrial Biomes",
    "35-4-aquatic-biomes": "Aquatic Biomes",
    "35-5-climate-and-the-effects-of-global-climate-change": (
        "Climate and the Effects of Global Climate Change"
    ),
    "36-1-population-demography": "Population Demography",
    "36-2-life-histories-and-natural-selection": "Life Histories and Natural Selection",
    "36-3-environmental-limits-to-population-growth": (
        "Environmental Limits to Population Growth"
    ),
    "36-4-population-dynamics-and-regulation": "Population Dynamics and Regulation",
    "36-5-human-population-growth": "Human Population Growth",
    "36-6-community-ecology": "Community Ecology",
    "36-7-behavioral-biology-proximate-and-ultimate-causes-of-behavior": (
        "Behavioral Biology: Proximate and Ultimate Causes of Behavior"
    ),
    "37-1-ecology-for-ecosystems": "Ecology for Ecosystems",
    "37-2-energy-flow-through-ecosystems": "Energy Flow Through Ecosystems",
    "37-3-biogeochemical-cycles": "Biogeochemical Cycles",
    "38-1-the-biodiversity-crisis": "The Biodiversity Crisis",
    "38-2-the-importance-of-biodiversity-to-human-life": (
        "The Importance of Biodiversity to Human Life"
    ),
    "38-3-threats-to-biodiversity": "Threats to Biodiversity",
    "38-4-preserving-biodiversity": "Preserving Biodiversity",
}


# Build a formatted string for LLM context
def get_chapter_list_for_llm() -> str:
  """Return a formatted list of all chapters for LLM context."""
  lines = []
  for slug, title in OPENSTAX_CHAPTERS.items():
    lines.append(f"- {slug}: {title}")
  return "\n".join(lines)


# Pre-computed keyword hints for faster matching (optional optimization)
# These keywords avoid expensive LLM calls for common biology topics.
# EXPANDED: Added more synonyms and common phrasings to reduce LLM fallback frequency.
KEYWORD_HINTS = {
    # Energy & Metabolism - EXPANDED with common variations
    "atp": ["6-4-atp-adenosine-triphosphate", "6-1-energy-and-metabolism"],
    "adenosine triphosphate": ["6-4-atp-adenosine-triphosphate"],
    "adp": ["6-4-atp-adenosine-triphosphate"],
    "adenosine diphosphate": ["6-4-atp-adenosine-triphosphate"],
    "cellular energy": [
        "6-4-atp-adenosine-triphosphate",
        "7-1-energy-in-living-systems",
    ],
    "cell energy": ["6-4-atp-adenosine-triphosphate", "7-1-energy-in-living-systems"],
    "high energy bond": ["6-4-atp-adenosine-triphosphate"],
    "phosphate bond": ["6-4-atp-adenosine-triphosphate"],
    "phosphate group": ["6-4-atp-adenosine-triphosphate"],
    "energy currency": ["6-4-atp-adenosine-triphosphate"],
    "energy transfer": [
        "6-4-atp-adenosine-triphosphate",
        "7-4-oxidative-phosphorylation",
    ],
    "bond breaking": ["6-4-atp-adenosine-triphosphate"],
    "bond energy": ["6-4-atp-adenosine-triphosphate", "6-1-energy-and-metabolism"],
    "hydrolysis": ["6-4-atp-adenosine-triphosphate"],
    "atp hydrolysis": ["6-4-atp-adenosine-triphosphate"],
    "exergonic": ["6-2-potential-kinetic-free-and-activation-energy"],
    "endergonic": ["6-2-potential-kinetic-free-and-activation-energy"],
    "gibbs free energy": ["6-2-potential-kinetic-free-and-activation-energy"],
    "thermodynamics": ["6-3-the-laws-of-thermodynamics"],
    "first law": ["6-3-the-laws-of-thermodynamics"],
    "second law": ["6-3-the-laws-of-thermodynamics"],
    "entropy": ["6-3-the-laws-of-thermodynamics"],
    "photosynthesis": [
        "8-1-overview-of-photosynthesis",
        "8-2-the-light-dependent-reaction-of-photosynthesis",
    ],
    "plants make food": ["8-1-overview-of-photosynthesis"],
    "chloroplast": ["8-1-overview-of-photosynthesis", "4-3-eukaryotic-cells"],
    "chlorophyll": ["8-2-the-light-dependent-reaction-of-photosynthesis"],
    "calvin cycle": ["8-3-using-light-to-make-organic-molecules"],
    "light reaction": ["8-2-the-light-dependent-reaction-of-photosynthesis"],
    "cellular respiration": [
        "7-1-energy-in-living-systems",
        "7-4-oxidative-phosphorylation",
    ],
    "glycolysis": ["7-2-glycolysis"],
    "krebs": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
    "citric acid": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
    "tca cycle": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
    "electron transport": ["7-4-oxidative-phosphorylation"],
    "oxidative phosphorylation": ["7-4-oxidative-phosphorylation"],
    "fermentation": ["7-5-metabolism-without-oxygen"],
    "anaerobic": ["7-5-metabolism-without-oxygen"],
    "mitochondria": ["7-4-oxidative-phosphorylation", "4-3-eukaryotic-cells"],
    "mitochondrion": ["7-4-oxidative-phosphorylation", "4-3-eukaryotic-cells"],
    # Cell Division
    "mitosis": ["10-1-cell-division", "10-2-the-cell-cycle"],
    "meiosis": ["11-1-the-process-of-meiosis"],
    "cell cycle": ["10-2-the-cell-cycle", "10-3-control-of-the-cell-cycle"],
    "cell division": ["10-1-cell-division"],
    "cancer": ["10-4-cancer-and-the-cell-cycle", "16-7-cancer-and-gene-regulation"],
    # Molecular Biology
    "dna": ["14-2-dna-structure-and-sequencing", "14-3-basics-of-dna-replication"],
    "rna": ["15-4-rna-processing-in-eukaryotes", "3-5-nucleic-acids"],
    "mrna": [
        "15-4-rna-processing-in-eukaryotes",
        "15-5-ribosomes-and-protein-synthesis",
    ],
    "trna": ["15-5-ribosomes-and-protein-synthesis"],
    "rrna": ["15-5-ribosomes-and-protein-synthesis"],
    "transcription": [
        "15-2-prokaryotic-transcription",
        "15-3-eukaryotic-transcription",
    ],
    "translation": ["15-5-ribosomes-and-protein-synthesis"],
    "protein synthesis": ["15-5-ribosomes-and-protein-synthesis"],
    "protein": ["3-4-proteins", "15-5-ribosomes-and-protein-synthesis"],
    "enzyme": ["6-5-enzymes"],
    "gene expression": ["16-1-regulation-of-gene-expression"],
    "genetic code": ["15-1-the-genetic-code"],
    "central dogma": ["15-1-the-genetic-code", "15-5-ribosomes-and-protein-synthesis"],
    "codon": ["15-1-the-genetic-code"],
    "anticodon": ["15-5-ribosomes-and-protein-synthesis"],
    "ribosome": ["15-5-ribosomes-and-protein-synthesis", "4-3-eukaryotic-cells"],
    "replication": [
        "14-3-basics-of-dna-replication",
        "14-4-dna-replication-in-prokaryotes",
    ],
    # Cell Structure
    "cell membrane": ["5-1-components-and-structure"],
    "plasma membrane": ["5-1-components-and-structure"],
    "membrane": ["5-1-components-and-structure", "5-2-passive-transport"],
    "phospholipid": ["5-1-components-and-structure", "3-3-lipids"],
    "osmosis": ["5-2-passive-transport", "32-1-osmoregulation-and-osmotic-balance"],
    "diffusion": ["5-2-passive-transport"],
    "active transport": ["5-3-active-transport"],
    "cytoskeleton": ["4-5-cytoskeleton"],
    "organelle": ["4-3-eukaryotic-cells", "4-4-the-endomembrane-system-and-proteins"],
    "nucleus": ["4-3-eukaryotic-cells"],
    "endoplasmic reticulum": ["4-4-the-endomembrane-system-and-proteins"],
    "golgi": ["4-4-the-endomembrane-system-and-proteins"],
    "lysosome": ["4-4-the-endomembrane-system-and-proteins"],
    "vesicle": ["5-4-bulk-transport", "4-4-the-endomembrane-system-and-proteins"],
    "endocytosis": ["5-4-bulk-transport"],
    "exocytosis": ["5-4-bulk-transport"],
    "signal transduction": [
        "9-1-signaling-molecules-and-cellular-receptors",
        "9-2-propagation-of-the-signal",
    ],
    "cell signaling": ["9-1-signaling-molecules-and-cellular-receptors"],
    # Nervous System
    "neuron": ["26-1-neurons-and-glial-cells", "26-2-how-neurons-communicate"],
    "nervous system": [
        "26-1-neurons-and-glial-cells",
        "26-3-the-central-nervous-system",
    ],
    "brain": ["26-3-the-central-nervous-system"],
    "action potential": ["26-2-how-neurons-communicate"],
    "synapse": ["26-2-how-neurons-communicate"],
    "senses": ["27-1-sensory-processes"],
    "vision": ["27-5-vision"],
    "hearing": ["27-4-hearing-and-vestibular-sensation"],
    # Circulatory System
    "heart": [
        "31-1-overview-of-the-circulatory-system",
        "31-3-mammalian-heart-and-blood-vessels",
    ],
    "blood": [
        "31-2-components-of-the-blood",
        "31-1-overview-of-the-circulatory-system",
    ],
    "circulatory": ["31-1-overview-of-the-circulatory-system"],
    "cardiovascular": ["31-1-overview-of-the-circulatory-system"],
    # Immune System
    "immune": ["33-1-innate-immune-response", "33-2-adaptive-immune-response"],
    "antibod": ["33-3-antibodies"],
    "infection": ["33-1-innate-immune-response"],
    "vaccine": ["33-2-adaptive-immune-response"],
    # Other Body Systems
    "respiration": ["30-1-systems-of-gas-exchange", "30-3-breathing"],
    "breathing": ["30-3-breathing"],
    "lung": ["30-1-systems-of-gas-exchange"],
    "digestion": ["25-1-digestive-systems", "25-3-digestive-system-processes"],
    "stomach": ["25-1-digestive-systems"],
    "intestine": ["25-3-digestive-system-processes"],
    "hormone": [
        "28-1-types-of-hormones",
        "28-2-how-hormones-work",
        "28-4-regulation-of-hormone-production",
    ],
    "endocrine": [
        "28-5-endocrine-glands",
        "28-1-types-of-hormones",
        "28-2-how-hormones-work",
    ],
    "endocrine system": [
        "28-5-endocrine-glands",
        "28-1-types-of-hormones",
        "28-2-how-hormones-work",
        "28-3-regulation-of-body-processes",
    ],
    "pituitary": ["28-5-endocrine-glands", "28-4-regulation-of-hormone-production"],
    "thyroid": ["28-5-endocrine-glands", "28-3-regulation-of-body-processes"],
    "adrenal": ["28-5-endocrine-glands"],
    "pancreas": ["28-5-endocrine-glands", "28-3-regulation-of-body-processes"],
    "insulin": ["28-3-regulation-of-body-processes", "28-5-endocrine-glands"],
    "gland": ["28-5-endocrine-glands"],
    "muscle": ["29-4-muscle-contraction-and-locomotion"],
    "bone": ["29-2-bone"],
    "skeleton": ["29-1-types-of-skeletal-systems"],
    "kidney": ["32-2-the-kidneys-and-osmoregulatory-organs"],
    "excretion": ["32-3-excretion-systems"],
    "reproduction": [
        "34-1-reproduction-methods",
        "34-3-human-reproductive-anatomy-and-gametogenesis",
    ],
    "reproductive": [
        "34-1-reproduction-methods",
        "34-3-human-reproductive-anatomy-and-gametogenesis",
    ],
    "reproductive system": [
        "34-1-reproduction-methods",
        "34-3-human-reproductive-anatomy-and-gametogenesis",
        "34-4-hormonal-control-of-human-reproduction",
    ],
    "pregnancy": ["34-7-human-pregnancy-and-birth"],
    "embryo": ["34-5-fertilization-and-early-embryonic-development"],
    # Evolution & Genetics
    "evolution": ["18-1-understanding-evolution", "19-1-population-evolution"],
    "darwin": ["18-1-understanding-evolution"],
    "natural selection": [
        "19-3-adaptive-evolution",
        "36-2-life-histories-and-natural-selection",
    ],
    "speciation": ["18-2-formation-of-new-species"],
    "genetics": [
        "12-1-mendels-experiments-and-the-laws-of-probability",
        "12-3-laws-of-inheritance",
    ],
    "mendel": ["12-1-mendels-experiments-and-the-laws-of-probability"],
    "inheritance": ["12-3-laws-of-inheritance"],
    "heredity": ["12-3-laws-of-inheritance"],
    "mutation": ["14-6-dna-repair"],
    "phylogen": ["20-2-determining-evolutionary-relationships"],
    # Microorganisms
    "virus": [
        "21-1-viral-evolution-morphology-and-classification",
        "21-2-virus-infection-and-hosts",
    ],
    "bacteria": ["22-1-prokaryotic-diversity", "22-4-bacterial-diseases-in-humans"],
    "prokaryote": ["4-2-prokaryotic-cells", "22-1-prokaryotic-diversity"],
    "eukaryote": ["4-3-eukaryotic-cells"],
    # Plants
    "plant": ["23-1-the-plant-body"],
    "leaf": ["23-4-leaves"],
    "root": ["23-3-roots"],
    "stem": ["23-2-stems"],
    "xylem": ["23-5-transport-of-water-and-solutes-in-plants"],
    "phloem": ["23-5-transport-of-water-and-solutes-in-plants"],
    # Ecology
    "ecology": ["35-1-the-scope-of-ecology", "36-6-community-ecology"],
    "ecosystem": ["37-1-ecology-for-ecosystems", "37-2-energy-flow-through-ecosystems"],
    "food chain": ["37-2-energy-flow-through-ecosystems"],
    "food web": ["37-2-energy-flow-through-ecosystems"],
    "biome": ["35-3-terrestrial-biomes", "35-4-aquatic-biomes"],
    "population": [
        "36-1-population-demography",
        "36-3-environmental-limits-to-population-growth",
    ],
    "climate": ["35-5-climate-and-the-effects-of-global-climate-change"],
    "climate change": ["35-5-climate-and-the-effects-of-global-climate-change"],
    "biodiversity": ["38-1-the-biodiversity-crisis", "38-4-preserving-biodiversity"],
    "carbon cycle": ["37-3-biogeochemical-cycles"],
    "nitrogen cycle": ["37-3-biogeochemical-cycles"],
    # Chemistry Basics
    "atom": ["2-1-atoms-isotopes-ions-and-molecules-the-building-blocks"],
    "water": ["2-2-water"],
    "carbon": ["2-3-carbon"],
    "carbohydrate": ["3-2-carbohydrates"],
    "lipid": ["3-3-lipids"],
    "nucleic acid": ["3-5-nucleic-acids"],
    # Biotechnology
    "biotechnology": ["17-1-biotechnology"],
    "crispr": ["17-1-biotechnology"],
    "cloning": ["17-1-biotechnology"],
    "genome": ["17-2-mapping-genomes", "17-3-whole-genome-sequencing"],
    "genomics": ["17-4-applying-genomics", "17-5-genomics-and-proteomics"],
    # Additional keywords for better coverage (plurals and common phrases)
    # Energy & Metabolism
    "light reactions": ["8-2-the-light-dependent-reaction-of-photosynthesis"],
    "energy metabolism": ["6-1-energy-and-metabolism", "7-1-energy-in-living-systems"],
    "metabolism": ["6-1-energy-and-metabolism", "7-1-energy-in-living-systems"],
    "enzymes": ["6-5-enzymes"],
    "proteins": ["3-4-proteins", "15-5-ribosomes-and-protein-synthesis"],
    "nucleic acids": ["3-5-nucleic-acids"],
    "ribosomes": ["15-5-ribosomes-and-protein-synthesis", "4-3-eukaryotic-cells"],
    # Body Systems (full names)
    "respiratory system": ["30-1-systems-of-gas-exchange", "30-3-breathing"],
    "digestive system": ["25-1-digestive-systems", "25-3-digestive-system-processes"],
    "skeletal system": ["29-1-types-of-skeletal-systems", "29-2-bone"],
    "muscular system": ["29-4-muscle-contraction-and-locomotion"],
    "circulatory system": ["31-1-overview-of-the-circulatory-system"],
    "immune system": ["33-1-innate-immune-response", "33-2-adaptive-immune-response"],
    # Plurals
    "hormones": ["28-1-types-of-hormones", "28-2-how-hormones-work"],
    "neurons": ["26-1-neurons-and-glial-cells", "26-2-how-neurons-communicate"],
    "lungs": ["30-1-systems-of-gas-exchange"],
    "kidneys": ["32-2-the-kidneys-and-osmoregulatory-organs"],
    "antibodies": ["33-3-antibodies"],
    "mutations": ["14-6-dna-repair"],
    "ecosystems": [
        "37-1-ecology-for-ecosystems",
        "37-2-energy-flow-through-ecosystems",
    ],
    "biomes": ["35-3-terrestrial-biomes", "35-4-aquatic-biomes"],
    "viruses": [
        "21-1-viral-evolution-morphology-and-classification",
        "21-2-virus-infection-and-hosts",
    ],
    "prokaryotes": ["4-2-prokaryotic-cells", "22-1-prokaryotic-diversity"],
    "eukaryotes": ["4-3-eukaryotic-cells"],
    "chromosomes": [
        "13-1-chromosomal-theory-and-genetic-linkages",
        "13-2-chromosomal-basis-of-inherited-disorders",
    ],
    # Genetics
    "homeostasis": ["24-3-homeostasis"],
    "chromosome": [
        "13-1-chromosomal-theory-and-genetic-linkages",
        "13-2-chromosomal-basis-of-inherited-disorders",
    ],
    "allele": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "alleles": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "dominant": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "recessive": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "dominant traits": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "recessive traits": ["12-2-characteristics-and-traits", "12-3-laws-of-inheritance"],
    "genetic disorders": ["13-2-chromosomal-basis-of-inherited-disorders"],
    "genetic disorder": ["13-2-chromosomal-basis-of-inherited-disorders"],
    # Evolution
    "adaptation": ["19-3-adaptive-evolution"],
    "phylogenetic": [
        "20-2-determining-evolutionary-relationships",
        "20-3-perspectives-on-the-phylogenetic-tree",
    ],
    "phylogenetics": [
        "20-2-determining-evolutionary-relationships",
        "20-3-perspectives-on-the-phylogenetic-tree",
    ],
    "fossil": ["18-1-understanding-evolution"],
    "fossils": ["18-1-understanding-evolution"],
    "common ancestor": ["20-2-determining-evolutionary-relationships"],
    "ancestors": ["20-2-determining-evolutionary-relationships"],
    # Ecology
    "energy flow": ["37-2-energy-flow-through-ecosystems"],
    "trophic": ["37-2-energy-flow-through-ecosystems"],
}


# =============================================================================
# CHAPTER TO MODULE ID MAPPING
# Maps chapter slugs to their corresponding module IDs from the OpenStax GitHub
# These IDs were verified against the actual OpenStax osbooks-biology-bundle repo
# =============================================================================

CHAPTER_TO_MODULES: dict[str, list[str]] = {
    "1-1-the-science-of-biology": ["m62717"],
    "1-2-themes-and-concepts-of-biology": ["m62718"],
    "2-1-atoms-isotopes-ions-and-molecules-the-building-blocks": ["m62720"],
    "2-2-water": ["m62721"],
    "2-3-carbon": ["m62722"],
    "3-1-synthesis-of-biological-macromolecules": ["m62724"],
    "3-2-carbohydrates": ["m62726"],
    "3-3-lipids": ["m62730"],
    "3-4-proteins": ["m62733"],
    "3-5-nucleic-acids": ["m62735"],
    "4-1-studying-cells": ["m62738"],
    "4-2-prokaryotic-cells": ["m62740"],
    "4-3-eukaryotic-cells": ["m62742"],
    "4-4-the-endomembrane-system-and-proteins": ["m62743"],
    "4-5-cytoskeleton": ["m62744"],
    "4-6-connections-between-cells-and-cellular-activities": ["m62746"],
    "5-1-components-and-structure": ["m62773"],
    "5-2-passive-transport": ["m62753"],
    "5-3-active-transport": ["m62770"],
    "5-4-bulk-transport": ["m62772"],
    "6-1-energy-and-metabolism": ["m62763"],
    "6-2-potential-kinetic-free-and-activation-energy": ["m62764"],
    "6-3-the-laws-of-thermodynamics": ["m62767"],
    "6-4-atp-adenosine-triphosphate": ["m62768"],
    "6-5-enzymes": ["m62778"],
    "7-1-energy-in-living-systems": ["m62786"],
    "7-2-glycolysis": ["m62787"],
    "7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle": ["m62788"],
    "7-4-oxidative-phosphorylation": ["m62789"],
    "7-5-metabolism-without-oxygen": ["m62790"],
    "7-6-connections-of-carbohydrate-protein-and-lipid-metabolic-pathways": ["m62791"],
    "7-7-regulation-of-cellular-respiration": ["m62792"],
    "8-1-overview-of-photosynthesis": ["m62794"],
    "8-2-the-light-dependent-reaction-of-photosynthesis": ["m62795"],
    "8-3-using-light-to-make-organic-molecules": ["m62796"],
    "9-1-signaling-molecules-and-cellular-receptors": ["m62798"],
    "9-2-propagation-of-the-signal": ["m62799"],
    "9-3-response-to-the-signal": ["m62800"],
    "9-4-signaling-in-single-celled-organisms": ["m62801"],
    "10-1-cell-division": ["m62803"],
    "10-2-the-cell-cycle": ["m62804"],
    "10-3-control-of-the-cell-cycle": ["m62805"],
    "10-4-cancer-and-the-cell-cycle": ["m62806"],
    "10-5-prokaryotic-cell-division": ["m62808"],
    "11-1-the-process-of-meiosis": ["m62810"],
    "11-2-sexual-reproduction": ["m62811"],
    "12-1-mendels-experiments-and-the-laws-of-probability": ["m62813"],
    "12-2-characteristics-and-traits": ["m62817"],
    "12-3-laws-of-inheritance": ["m62819"],
    "13-1-chromosomal-theory-and-genetic-linkages": ["m62821"],
    "13-2-chromosomal-basis-of-inherited-disorders": ["m62822"],
    "14-1-historical-basis-of-modern-understanding": ["m62824"],
    "14-2-dna-structure-and-sequencing": ["m62825"],
    "14-3-basics-of-dna-replication": ["m62826"],
    "14-4-dna-replication-in-prokaryotes": ["m62828"],
    "14-5-dna-replication-in-eukaryotes": ["m62829"],
    "14-6-dna-repair": ["m62830"],
    "15-1-the-genetic-code": ["m62837"],
    "15-2-prokaryotic-transcription": ["m62838"],
    "15-3-eukaryotic-transcription": ["m62840"],
    "15-4-rna-processing-in-eukaryotes": ["m62842"],
    "15-5-ribosomes-and-protein-synthesis": ["m62843"],
    "16-1-regulation-of-gene-expression": ["m62845"],
    "16-2-prokaryotic-gene-regulation": ["m62846"],
    "16-3-eukaryotic-epigenetic-gene-regulation": ["m62847"],
    "16-4-eukaryotic-transcriptional-gene-regulation": ["m62848"],
    "16-5-eukaryotic-post-transcriptional-gene-regulation": ["m62849"],
    "16-6-eukaryotic-translational-and-post-translational-gene-regulation": ["m62850"],
    "16-7-cancer-and-gene-regulation": ["m62851"],
    "17-1-biotechnology": ["m62853"],
    "17-2-mapping-genomes": ["m62855"],
    "17-3-whole-genome-sequencing": ["m62857"],
    "17-4-applying-genomics": ["m62860"],
    "17-5-genomics-and-proteomics": ["m62861"],
    "18-1-understanding-evolution": ["m62863"],
    "18-2-formation-of-new-species": ["m62864"],
    "18-3-reconnection-and-rates-of-speciation": ["m62865"],
    "19-1-population-evolution": ["m62868"],
    "19-2-population-genetics": ["m62870"],
    "19-3-adaptive-evolution": ["m62871"],
    "20-1-organizing-life-on-earth": ["m62874"],
    "20-2-determining-evolutionary-relationships": ["m62903"],
    "20-3-perspectives-on-the-phylogenetic-tree": ["m62876"],
    "21-1-viral-evolution-morphology-and-classification": ["m62881"],
    "21-2-virus-infection-and-hosts": ["m62882"],
    "21-3-prevention-and-treatment-of-viral-infections": ["m62904"],
    "21-4-other-acellular-entities-prions-and-viroids": ["m62887"],
    "22-1-prokaryotic-diversity": ["m62891"],
    "22-2-structure-of-prokaryotes": ["m62893"],
    "22-3-prokaryotic-metabolism": ["m62894"],
    "22-4-bacterial-diseases-in-humans": ["m62896"],
    "22-5-beneficial-prokaryotes": ["m62897"],
    "23-1-the-plant-body": ["m62951"],
    "23-2-stems": ["m62905"],
    "23-3-roots": ["m62906"],
    "23-4-leaves": ["m62908"],
    "23-5-transport-of-water-and-solutes-in-plants": ["m62969"],
    "23-6-plant-sensory-systems-and-responses": ["m62930"],
    "24-1-animal-form-and-function": ["m62916"],
    "24-2-animal-primary-tissues": ["m62918"],
    "24-3-homeostasis": ["m62931"],
    "25-1-digestive-systems": ["m62919"],
    "25-2-nutrition-and-energy-production": ["m62920"],
    "25-3-digestive-system-processes": ["m62921"],
    "25-4-digestive-system-regulation": ["m62922"],
    "26-1-neurons-and-glial-cells": ["m62924"],
    "26-2-how-neurons-communicate": ["m62925"],
    "26-3-the-central-nervous-system": ["m62926"],
    "26-4-the-peripheral-nervous-system": ["m62928"],
    "26-5-nervous-system-disorders": ["m62929"],
    "27-1-sensory-processes": ["m62994"],
    "27-2-somatosensation": ["m62946"],
    "27-3-taste-and-smell": ["m62947"],
    "27-4-hearing-and-vestibular-sensation": ["m62954"],
    "27-5-vision": ["m62957"],
    "28-1-types-of-hormones": ["m62961"],
    "28-2-how-hormones-work": ["m62963"],
    "28-3-regulation-of-body-processes": ["m62996"],
    "28-4-regulation-of-hormone-production": ["m62971"],
    "28-5-endocrine-glands": ["m62995"],
    "29-1-types-of-skeletal-systems": ["m62977"],
    "29-2-bone": ["m62978"],
    "29-3-joints-and-skeletal-movement": ["m62979"],
    "29-4-muscle-contraction-and-locomotion": ["m62980"],
    "30-1-systems-of-gas-exchange": ["m62982"],
    "30-2-gas-exchange-across-respiratory-surfaces": ["m62998"],
    "30-3-breathing": ["m62987"],
    "30-4-transport-of-gases-in-human-bodily-fluids": ["m62988"],
    "31-1-overview-of-the-circulatory-system": ["m62990"],
    "31-2-components-of-the-blood": ["m62991"],
    "31-3-mammalian-heart-and-blood-vessels": ["m62992"],
    "31-4-blood-flow-and-blood-pressure-regulation": ["m62993"],
    "32-1-osmoregulation-and-osmotic-balance": ["m63000"],
    "32-2-the-kidneys-and-osmoregulatory-organs": ["m63001"],
    "32-3-excretion-systems": ["m63002"],
    "32-4-nitrogenous-wastes": ["m63003"],
    "32-5-hormonal-control-of-osmoregulatory-functions": ["m63004"],
    "33-1-innate-immune-response": ["m63006"],
    "33-2-adaptive-immune-response": ["m63007"],
    "33-3-antibodies": ["m63008"],
    "33-4-disruptions-in-the-immune-system": ["m63009"],
    "34-1-reproduction-methods": ["m63011"],
    "34-2-fertilization": ["m63012"],
    "34-3-human-reproductive-anatomy-and-gametogenesis": ["m63013"],
    "34-4-hormonal-control-of-human-reproduction": ["m63014"],
    "34-5-fertilization-and-early-embryonic-development": ["m63016"],
    "34-6-organogenesis-and-vertebrate-axis-formation": ["m63043"],
    "34-7-human-pregnancy-and-birth": ["m63018"],
    "35-1-the-scope-of-ecology": ["m63021"],
    "35-2-biogeography": ["m63023"],
    "35-3-terrestrial-biomes": ["m63024"],
    "35-4-aquatic-biomes": ["m63025"],
    "35-5-climate-and-the-effects-of-global-climate-change": ["m63026"],
    "36-1-population-demography": ["m63028"],
    "36-2-life-histories-and-natural-selection": ["m63029"],
    "36-3-environmental-limits-to-population-growth": ["m63030"],
    "36-4-population-dynamics-and-regulation": ["m63031"],
    "36-5-human-population-growth": ["m63032"],
    "36-6-community-ecology": ["m63033"],
    "36-7-behavioral-biology-proximate-and-ultimate-causes-of-behavior": ["m63034"],
    "37-1-ecology-for-ecosystems": ["m63036"],
    "37-2-energy-flow-through-ecosystems": ["m63037"],
    "37-3-biogeochemical-cycles": ["m63040"],
    "38-1-the-biodiversity-crisis": ["m63048"],
    "38-2-the-importance-of-biodiversity-to-human-life": ["m63049"],
    "38-3-threats-to-biodiversity": ["m63050"],
    "38-4-preserving-biodiversity": ["m63051"],
}


def get_module_ids_for_chapter(chapter_slug: str) -> list[str]:
  """Get the module IDs for a given chapter slug."""
  return CHAPTER_TO_MODULES.get(chapter_slug, [])


def get_all_module_ids() -> list[str]:
  """Get all unique module IDs across all chapters."""
  all_modules = set()
  for modules in CHAPTER_TO_MODULES.values():
    all_modules.update(modules)
  return sorted(all_modules)


def get_github_url_for_module(module_id: str) -> str:
  """Get the GitHub raw URL for a module's CNXML file."""
  return f"{GITHUB_RAW_BASE}/{module_id}/index.cnxml"


def get_openstax_url_for_chapter(chapter_slug: str) -> str:
  """Get the OpenStax website URL for a chapter (for citations)."""
  return f"{OPENSTAX_WEB_BASE}/{chapter_slug}"

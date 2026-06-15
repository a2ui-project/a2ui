#!/usr/bin/env python3
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
Personalized Learning Agent - Deployment Script for Agent Engine

This script deploys the ADK agent to Vertex AI Agent Engine.

Required environment variables:
  GOOGLE_CLOUD_PROJECT - Your GCP project ID

Optional environment variables:
  GOOGLE_CLOUD_LOCATION - GCP region (default: us-central1)

Usage:
  python deploy.py --project YOUR_PROJECT_ID
  python deploy.py --project YOUR_PROJECT_ID --location us-central1
  python deploy.py --list  # List deployed agents
"""

import os
import ssl
import sys
import argparse
import logging

try:
    import certifi
    _HAS_CERTIFI = True
except ImportError:
    _HAS_CERTIFI = False

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="Deploy the Personalized Learning Agent to Agent Engine"
    )
    parser.add_argument(
        "--project",
        type=str,
        default=os.getenv("GOOGLE_CLOUD_PROJECT"),
        help="GCP project ID",
    )
    parser.add_argument(
        "--location",
        type=str,
        default=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        help="GCP location (default: us-central1)",
    )
    parser.add_argument(
        "--context-bucket",
        type=str,
        default=None,
        help="GCS bucket for learner context (default: {project}-learner-context)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List deployed agents instead of deploying",
    )

    args = parser.parse_args()

    if not args.project:
        print("ERROR: --project flag or GOOGLE_CLOUD_PROJECT environment variable is required")
        sys.exit(1)

    # Set context bucket (default to {project}-learner-context)
    context_bucket = args.context_bucket or f"{args.project}-learner-context"

    # Set environment variables
    os.environ["GOOGLE_CLOUD_PROJECT"] = args.project
    os.environ["GOOGLE_CLOUD_LOCATION"] = args.location
    os.environ["GCS_CONTEXT_BUCKET"] = context_bucket

    # Import Vertex AI modules
    import vertexai
    from vertexai import agent_engines

    # Initialize Vertex AI
    staging_bucket = f"gs://{args.project}_cloudbuild"
    vertexai.init(
        project=args.project,
        location=args.location,
        staging_bucket=staging_bucket,
    )

    if args.list:
        print(f"\nDeployed agents in {args.project} ({args.location}):")
        for engine in agent_engines.list():
            print(f"  - {engine.display_name}: {engine.resource_name}")
        return

    print("Deploying Personalized Learning Agent...")
    print(f"  Project: {args.project}")
    print(f"  Location: {args.location}")
    print(f"  Context bucket: gs://{context_bucket}/learner_context/")
    print()

    # =========================================================================
    # CREATE THE ADK AGENT
    # =========================================================================
    # Create an Agent, wrap it in AdkApp, and deploy the AdkApp directly. 
    # AdkApp is designed to be picklable.
    # =========================================================================

    import json
    import re
    import xml.etree.ElementTree as ET
    from google.adk.agents import Agent
    from google.adk.tools import ToolContext
    from vertexai.agent_engines import AdkApp

    model_id = os.getenv("GENAI_MODEL", "gemini-2.5-flash")
    SURFACE_ID = "learningContent"

    # =========================================================================
    # OPENSTAX CONTENT - Chapter mappings and content fetching
    # =========================================================================

    # =========================================================================
    # COMPLETE OpenStax Biology AP Courses - Chapter mappings
    # Copied from agent/openstax_chapters.py for Agent Engine deployment
    # =========================================================================

    OPENSTAX_CHAPTERS = {
        # Unit 1: The Chemistry of Life
        "1-1-the-science-of-biology": "The Science of Biology",
        "1-2-themes-and-concepts-of-biology": "Themes and Concepts of Biology",
        "2-1-atoms-isotopes-ions-and-molecules-the-building-blocks": "Atoms, Isotopes, Ions, and Molecules: The Building Blocks",
        "2-2-water": "Water",
        "2-3-carbon": "Carbon",
        "3-1-synthesis-of-biological-macromolecules": "Synthesis of Biological Macromolecules",
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
        "4-6-connections-between-cells-and-cellular-activities": "Connections Between Cells and Cellular Activities",
        "5-1-components-and-structure": "Cell Membrane Components and Structure",
        "5-2-passive-transport": "Passive Transport",
        "5-3-active-transport": "Active Transport",
        "5-4-bulk-transport": "Bulk Transport",
        "6-1-energy-and-metabolism": "Energy and Metabolism",
        "6-2-potential-kinetic-free-and-activation-energy": "Potential, Kinetic, Free, and Activation Energy",
        "6-3-the-laws-of-thermodynamics": "The Laws of Thermodynamics",
        "6-4-atp-adenosine-triphosphate": "ATP: Adenosine Triphosphate",
        "6-5-enzymes": "Enzymes",
        "7-1-energy-in-living-systems": "Energy in Living Systems",
        "7-2-glycolysis": "Glycolysis",
        "7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle": "Oxidation of Pyruvate and the Citric Acid Cycle",
        "7-4-oxidative-phosphorylation": "Oxidative Phosphorylation",
        "7-5-metabolism-without-oxygen": "Metabolism Without Oxygen",
        "7-6-connections-of-carbohydrate-protein-and-lipid-metabolic-pathways": "Connections of Carbohydrate, Protein, and Lipid Metabolic Pathways",
        "7-7-regulation-of-cellular-respiration": "Regulation of Cellular Respiration",
        "8-1-overview-of-photosynthesis": "Overview of Photosynthesis",
        "8-2-the-light-dependent-reaction-of-photosynthesis": "The Light-Dependent Reactions of Photosynthesis",
        "8-3-using-light-to-make-organic-molecules": "Using Light to Make Organic Molecules",
        "9-1-signaling-molecules-and-cellular-receptors": "Signaling Molecules and Cellular Receptors",
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
        "12-1-mendels-experiments-and-the-laws-of-probability": "Mendel's Experiments and the Laws of Probability",
        "12-2-characteristics-and-traits": "Characteristics and Traits",
        "12-3-laws-of-inheritance": "Laws of Inheritance",
        "13-1-chromosomal-theory-and-genetic-linkages": "Chromosomal Theory and Genetic Linkages",
        "13-2-chromosomal-basis-of-inherited-disorders": "Chromosomal Basis of Inherited Disorders",
        "14-1-historical-basis-of-modern-understanding": "Historical Basis of Modern Understanding of DNA",
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
        "16-3-eukaryotic-epigenetic-gene-regulation": "Eukaryotic Epigenetic Gene Regulation",
        "16-4-eukaryotic-transcriptional-gene-regulation": "Eukaryotic Transcriptional Gene Regulation",
        "16-5-eukaryotic-post-transcriptional-gene-regulation": "Eukaryotic Post-transcriptional Gene Regulation",
        "16-6-eukaryotic-translational-and-post-translational-gene-regulation": "Eukaryotic Translational and Post-translational Gene Regulation",
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
        "20-2-determining-evolutionary-relationships": "Determining Evolutionary Relationships",
        "20-3-perspectives-on-the-phylogenetic-tree": "Perspectives on the Phylogenetic Tree",
        # Unit 5: Biological Diversity
        "21-1-viral-evolution-morphology-and-classification": "Viral Evolution, Morphology, and Classification",
        "21-2-virus-infection-and-hosts": "Virus Infection and Hosts",
        "21-3-prevention-and-treatment-of-viral-infections": "Prevention and Treatment of Viral Infections",
        "21-4-other-acellular-entities-prions-and-viroids": "Other Acellular Entities: Prions and Viroids",
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
        "23-5-transport-of-water-and-solutes-in-plants": "Transport of Water and Solutes in Plants",
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
        "30-2-gas-exchange-across-respiratory-surfaces": "Gas Exchange Across Respiratory Surfaces",
        "30-3-breathing": "Breathing",
        "30-4-transport-of-gases-in-human-bodily-fluids": "Transport of Gases in Human Bodily Fluids",
        "31-1-overview-of-the-circulatory-system": "Overview of the Circulatory System",
        "31-2-components-of-the-blood": "Components of the Blood",
        "31-3-mammalian-heart-and-blood-vessels": "Mammalian Heart and Blood Vessels",
        "31-4-blood-flow-and-blood-pressure-regulation": "Blood Flow and Blood Pressure Regulation",
        "32-1-osmoregulation-and-osmotic-balance": "Osmoregulation and Osmotic Balance",
        "32-2-the-kidneys-and-osmoregulatory-organs": "The Kidneys and Osmoregulatory Organs",
        "32-3-excretion-systems": "Excretion Systems",
        "32-4-nitrogenous-wastes": "Nitrogenous Wastes",
        "32-5-hormonal-control-of-osmoregulatory-functions": "Hormonal Control of Osmoregulatory Functions",
        "33-1-innate-immune-response": "Innate Immune Response",
        "33-2-adaptive-immune-response": "Adaptive Immune Response",
        "33-3-antibodies": "Antibodies",
        "33-4-disruptions-in-the-immune-system": "Disruptions in the Immune System",
        "34-1-reproduction-methods": "Reproduction Methods",
        "34-2-fertilization": "Fertilization",
        "34-3-human-reproductive-anatomy-and-gametogenesis": "Human Reproductive Anatomy and Gametogenesis",
        "34-4-hormonal-control-of-human-reproduction": "Hormonal Control of Human Reproduction",
        "34-5-fertilization-and-early-embryonic-development": "Fertilization and Early Embryonic Development",
        "34-6-organogenesis-and-vertebrate-axis-formation": "Organogenesis and Vertebrate Axis Formation",
        "34-7-human-pregnancy-and-birth": "Human Pregnancy and Birth",
        # Unit 8: Ecology
        "35-1-the-scope-of-ecology": "The Scope of Ecology",
        "35-2-biogeography": "Biogeography",
        "35-3-terrestrial-biomes": "Terrestrial Biomes",
        "35-4-aquatic-biomes": "Aquatic Biomes",
        "35-5-climate-and-the-effects-of-global-climate-change": "Climate and the Effects of Global Climate Change",
        "36-1-population-demography": "Population Demography",
        "36-2-life-histories-and-natural-selection": "Life Histories and Natural Selection",
        "36-3-environmental-limits-to-population-growth": "Environmental Limits to Population Growth",
        "36-4-population-dynamics-and-regulation": "Population Dynamics and Regulation",
        "36-5-human-population-growth": "Human Population Growth",
        "36-6-community-ecology": "Community Ecology",
        "36-7-behavioral-biology-proximate-and-ultimate-causes-of-behavior": "Behavioral Biology: Proximate and Ultimate Causes of Behavior",
        "37-1-ecology-for-ecosystems": "Ecology for Ecosystems",
        "37-2-energy-flow-through-ecosystems": "Energy Flow Through Ecosystems",
        "37-3-biogeochemical-cycles": "Biogeochemical Cycles",
        "38-1-the-biodiversity-crisis": "The Biodiversity Crisis",
        "38-2-the-importance-of-biodiversity-to-human-life": "The Importance of Biodiversity to Human Life",
        "38-3-threats-to-biodiversity": "Threats to Biodiversity",
        "38-4-preserving-biodiversity": "Preserving Biodiversity",
    }

    # Complete chapter to module ID mapping - GENERATED FROM openstax_modules.py
    # Each chapter slug maps to the correct module ID(s) from the OpenStax collection
    CHAPTER_TO_MODULES = {
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

    # Complete keyword hints for fast matching (Tier 1)
    # NOTE: Order matters! More specific keywords should come BEFORE generic ones
    # because matched_slugs uses list with first-match priority
    KEYWORD_HINTS = {
        # Energy & Metabolism - SPECIFIC terms first, then generic
        "krebs": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
        "citric acid": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
        "tca cycle": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle"],
        "glycolysis": ["7-2-glycolysis"],
        "electron transport": ["7-4-oxidative-phosphorylation"],
        "oxidative phosphorylation": ["7-4-oxidative-phosphorylation"],
        "fermentation": ["7-5-metabolism-without-oxygen"],
        "anaerobic": ["7-5-metabolism-without-oxygen"],
        "cellular respiration": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle", "7-4-oxidative-phosphorylation"],
        "mitochondria": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle", "7-4-oxidative-phosphorylation"],
        "mitochondrion": ["7-3-oxidation-of-pyruvate-and-the-citric-acid-cycle", "7-4-oxidative-phosphorylation"],
        "atp": ["6-4-atp-adenosine-triphosphate", "7-4-oxidative-phosphorylation"],
        "adenosine triphosphate": ["6-4-atp-adenosine-triphosphate"],
        "photosynthesis": ["8-1-overview-of-photosynthesis", "8-2-the-light-dependent-reaction-of-photosynthesis"],
        "plants make food": ["8-1-overview-of-photosynthesis"],
        "chloroplast": ["8-1-overview-of-photosynthesis", "4-3-eukaryotic-cells"],
        "chlorophyll": ["8-2-the-light-dependent-reaction-of-photosynthesis"],
        "calvin cycle": ["8-3-using-light-to-make-organic-molecules"],
        "light reaction": ["8-2-the-light-dependent-reaction-of-photosynthesis"],
        # Cell Division
        "mitosis": ["10-1-cell-division", "10-2-the-cell-cycle"],
        "meiosis": ["11-1-the-process-of-meiosis"],
        "cell cycle": ["10-2-the-cell-cycle", "10-3-control-of-the-cell-cycle"],
        "cell division": ["10-1-cell-division"],
        "cancer": ["10-4-cancer-and-the-cell-cycle", "16-7-cancer-and-gene-regulation"],
        # Molecular Biology
        "dna": ["14-2-dna-structure-and-sequencing", "14-3-basics-of-dna-replication"],
        "rna": ["15-4-rna-processing-in-eukaryotes", "3-5-nucleic-acids"],
        "mrna": ["15-4-rna-processing-in-eukaryotes", "15-5-ribosomes-and-protein-synthesis"],
        "trna": ["15-5-ribosomes-and-protein-synthesis"],
        "rrna": ["15-5-ribosomes-and-protein-synthesis"],
        "transcription": ["15-2-prokaryotic-transcription", "15-3-eukaryotic-transcription"],
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
        "replication": ["14-3-basics-of-dna-replication", "14-4-dna-replication-in-prokaryotes"],
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
        "signal transduction": ["9-1-signaling-molecules-and-cellular-receptors", "9-2-propagation-of-the-signal"],
        "cell signaling": ["9-1-signaling-molecules-and-cellular-receptors"],
        # Nervous System
        "neuron": ["26-1-neurons-and-glial-cells", "26-2-how-neurons-communicate"],
        "nervous system": ["26-1-neurons-and-glial-cells", "26-3-the-central-nervous-system"],
        "brain": ["26-3-the-central-nervous-system"],
        "action potential": ["26-2-how-neurons-communicate"],
        "synapse": ["26-2-how-neurons-communicate"],
        "senses": ["27-1-sensory-processes"],
        "vision": ["27-5-vision"],
        "hearing": ["27-4-hearing-and-vestibular-sensation"],
        # Circulatory System
        "heart": ["31-1-overview-of-the-circulatory-system", "31-3-mammalian-heart-and-blood-vessels"],
        "blood": ["31-2-components-of-the-blood", "31-1-overview-of-the-circulatory-system"],
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
        "hormone": ["28-1-types-of-hormones", "28-2-how-hormones-work"],
        "endocrine": ["28-5-endocrine-glands", "28-1-types-of-hormones", "28-2-how-hormones-work"],
        "endocrine system": ["28-5-endocrine-glands", "28-1-types-of-hormones", "28-2-how-hormones-work"],
        "muscle": ["29-4-muscle-contraction-and-locomotion"],
        "bone": ["29-2-bone"],
        "skeleton": ["29-1-types-of-skeletal-systems"],
        "kidney": ["32-2-the-kidneys-and-osmoregulatory-organs"],
        "excretion": ["32-3-excretion-systems"],
        "reproduction": ["34-1-reproduction-methods", "34-3-human-reproductive-anatomy-and-gametogenesis"],
        "reproductive": ["34-1-reproduction-methods", "34-3-human-reproductive-anatomy-and-gametogenesis"],
        "reproductive system": ["34-1-reproduction-methods", "34-3-human-reproductive-anatomy-and-gametogenesis", "34-4-hormonal-control-of-human-reproduction"],
        "pregnancy": ["34-7-human-pregnancy-and-birth"],
        "embryo": ["34-5-fertilization-and-early-embryonic-development"],
        # Evolution & Genetics
        "evolution": ["18-1-understanding-evolution", "19-1-population-evolution"],
        "darwin": ["18-1-understanding-evolution"],
        "natural selection": ["19-3-adaptive-evolution", "36-2-life-histories-and-natural-selection"],
        "speciation": ["18-2-formation-of-new-species"],
        "genetics": ["12-1-mendels-experiments-and-the-laws-of-probability", "12-3-laws-of-inheritance"],
        "mendel": ["12-1-mendels-experiments-and-the-laws-of-probability"],
        "inheritance": ["12-3-laws-of-inheritance"],
        "heredity": ["12-3-laws-of-inheritance"],
        "mutation": ["14-6-dna-repair"],
        "phylogen": ["20-2-determining-evolutionary-relationships"],
        # Microorganisms
        "virus": ["21-1-viral-evolution-morphology-and-classification", "21-2-virus-infection-and-hosts"],
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
        "population": ["36-1-population-demography", "36-3-environmental-limits-to-population-growth"],
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
    }

    def get_openstax_url(chapter_slug: str) -> str:
        """Get the OpenStax URL for a chapter."""
        return f"https://openstax.org/books/biology-ap-courses/pages/{chapter_slug}"

    def parse_cnxml_to_text(cnxml_content: str) -> str:
        """Parse CNXML content and extract plain text."""
        try:
            root = ET.fromstring(cnxml_content)
            ns = {"cnxml": "http://cnx.rice.edu/cnxml"}

            text_parts = []
            title_elem = root.find(".//cnxml:title", ns)
            if title_elem is not None and title_elem.text:
                text_parts.append(f"# {title_elem.text}\n")

            def extract_text(elem):
                texts = []
                if elem.text:
                    texts.append(elem.text)
                for child in elem:
                    texts.append(extract_text(child))
                    if child.tail:
                        texts.append(child.tail)
                return " ".join(texts)

            for elem in root.iter():
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                if tag == "para":
                    para_text = extract_text(elem)
                    if para_text.strip():
                        text_parts.append(para_text.strip())

            full_text = "\n".join(text_parts)
            full_text = re.sub(r'\n{3,}', '\n\n', full_text)
            return full_text.strip()
        except Exception:
            return re.sub(r'<[^>]+>', ' ', cnxml_content).strip()

    def get_chapter_list_for_llm() -> str:
        """Return a formatted list of all chapters for LLM context.

        Uses the complete OPENSTAX_CHAPTERS mapping defined above.
        """
        lines = []
        for slug, title in OPENSTAX_CHAPTERS.items():
            lines.append(f"- {slug}: {title}")
        return "\n".join(lines)

    def llm_match_topic_to_chapters(topic: str, max_chapters: int = 2) -> list:
        """Use Gemini to match a topic to the most relevant chapter slugs (Tier 2 matching).

        This is called when keyword matching (Tier 1) fails. It handles:
        - Misspellings (e.g., "meitosis" -> meiosis)
        - Alternate terms (e.g., "cell energy" -> ATP)
        - Complex queries that don't match simple keywords

        Returns empty list [] if the topic is not covered in the biology textbook.
        """
        from google import genai
        from google.genai import types

        try:
            # Use us-central1 for consistency with Agent Engine
            client = genai.Client(
                vertexai=True,
                project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
                location="us-central1",
            )

            chapter_list = get_chapter_list_for_llm()

            prompt = f"""You are a biology textbook expert. Match the user's topic to the MOST relevant chapters.

User's topic: "{topic}"

Available chapters from OpenStax Biology for AP Courses:
{chapter_list}

INSTRUCTIONS:
1. Return EXACTLY {max_chapters} chapter slugs that BEST match the topic
2. Order by relevance - put the MOST relevant chapter FIRST
3. For biology topics (even misspelled like "meitosis"), ALWAYS find matching chapters
4. Return empty [] ONLY for non-biology topics (physics, history, literature, etc.)
5. Match the topic DIRECTLY - "reproductive system" should match reproduction chapters (34-*), not meiosis

EXAMPLES:
- "reproductive system" → ["34-3-human-reproductive-anatomy-and-gametogenesis", "34-1-reproduction-methods"]
- "endocrine system" → ["28-5-endocrine-glands", "28-1-types-of-hormones"]
- "meiosis" → ["11-1-the-process-of-meiosis", "11-2-sexual-reproduction"]
- "ATP" → ["6-4-atp-adenosine-triphosphate", "6-1-energy-and-metabolism"]
- "quantum physics" → []

Return ONLY a JSON array with exactly {max_chapters} slugs (or [] for non-biology):"""

            response = client.models.generate_content(
                model=model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )

            slugs = json.loads(response.text.strip())
            if isinstance(slugs, list):
                # Validate that returned slugs actually exist in our chapter mapping
                valid_slugs = [s for s in slugs if s in OPENSTAX_CHAPTERS]
                return valid_slugs[:max_chapters]

        except Exception as e:
            logger.warning(f"LLM chapter matching failed: {e}")

        return []  # Return empty if LLM fails

    def fetch_openstax_content(topic: str) -> dict:
        """Fetch OpenStax content for a topic using keyword matching with LLM fallback."""
        import urllib.request
        import urllib.error

        topic_lower = topic.lower()
        matched_slugs = []  # Use list to preserve order (first match = highest priority)

        # First try keyword matching (fast path)
        # Use word boundary matching to avoid false positives like "vision" in "cell division"
        for keyword, slugs in KEYWORD_HINTS.items():
            # Check for word boundary match using regex
            # This ensures "vision" doesn't match "cell division"
            pattern = r'\b' + re.escape(keyword) + r'\b'
            if re.search(pattern, topic_lower):
                for slug in slugs:
                    if slug not in matched_slugs:
                        matched_slugs.append(slug)

        # If no keyword match, use LLM to find relevant chapters
        if not matched_slugs:
            llm_slugs = llm_match_topic_to_chapters(topic)
            if llm_slugs:
                for slug in llm_slugs:
                    if slug not in matched_slugs:
                        matched_slugs.append(slug)

        # If still no match (LLM found nothing relevant), return empty with clear message
        if not matched_slugs:
            return {
                "content": "",
                "sources": [],
                "note": f"I couldn't find any OpenStax Biology content related to '{topic}'. This topic may not be covered in the AP Biology curriculum."
            }

        chapter_slugs = list(matched_slugs)[:2]
        content_parts = []
        sources = []

        # Create SSL context once - use certifi CA bundle if available
        if _HAS_CERTIFI:
            ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        else:
            ssl_ctx = ssl.create_default_context()

        for slug in chapter_slugs:
            module_ids = CHAPTER_TO_MODULES.get(slug, [])
            if not module_ids:
                # Skip chapters without module mappings
                continue

            title = OPENSTAX_CHAPTERS.get(slug, slug)
            url = get_openstax_url(slug)
            chapter_content_found = False

            for module_id in module_ids:
                github_url = f"https://raw.githubusercontent.com/openstax/osbooks-biology-bundle/main/modules/{module_id}/index.cnxml"
                try:
                    with urllib.request.urlopen(github_url, timeout=10, context=ssl_ctx) as response:
                        cnxml = response.read().decode('utf-8')
                        text = parse_cnxml_to_text(cnxml)
                        if text:
                            content_parts.append(f"## {title}\n\n{text}")
                            chapter_content_found = True
                except Exception:
                    pass

            # Only add source if we actually got content for this chapter
            if chapter_content_found:
                sources.append({"title": title, "url": url, "provider": "OpenStax Biology for AP Courses"})

        return {
            "content": "\n\n---\n\n".join(content_parts) if content_parts else "",
            "sources": sources,
        }

    # =========================================================================
    # TOOL FUNCTIONS
    # =========================================================================

    async def generate_flashcards(
        tool_context: ToolContext,
        topic: str,
    ) -> str:
        """
        Generate personalized flashcard content as A2UI JSON.

        Args:
            topic: The topic for flashcards (e.g., "endocrine system", "photosynthesis", "meiosis")

        Returns:
            A2UI JSON string for Flashcard components
        """
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )

        # Fetch OpenStax content for context - REQUIRED
        openstax_data = fetch_openstax_content(topic)
        textbook_context = openstax_data.get("content", "")
        sources = openstax_data.get("sources", [])

        # If no OpenStax content found, return an error message instead of making up content
        if not textbook_context or not sources:
            components = [
                {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "message"]}, "distribution": "start", "alignment": "stretch"}}},
                {"id": "header", "component": {"Text": {"text": {"literalString": f"No Content Available: {topic}"}, "usageHint": "h3"}}},
                {"id": "message", "component": {"Text": {"text": {"literalString": f"Sorry, I couldn't find any OpenStax Biology content related to '{topic}'. This topic may not be covered in the AP Biology curriculum, or try rephrasing your request with more specific biology terms."}}}},
            ]
            a2ui = [
                {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
                {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
            ]
            return json.dumps({"format": "flashcards", "a2ui": a2ui, "surfaceId": SURFACE_ID, "source": {"title": "No content found", "url": "", "provider": "OpenStax Biology for AP Courses"}})

        prompt = f'''Create 4 MCAT study flashcards about "{topic}" for Maria (pre-med, loves gym analogies).
Use gym/sports analogies in the answers where appropriate.
IMPORTANT: Base all content ONLY on the textbook content provided below. Do not add information not present in the source.

Textbook source content:
{textbook_context[:4000]}'''

        flashcard_schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "front": {"type": "string", "description": "The question on the front of the flashcard"},
                    "back": {"type": "string", "description": "The answer on the back, using gym analogies"},
                    "category": {"type": "string", "description": "Category like Biochemistry"},
                },
                "required": ["front", "back", "category"],
            },
        }

        response = client.models.generate_content(
            model=model_id,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=flashcard_schema,
            ),
        )
        cards = json.loads(response.text.strip())

        # Handle case where LLM returns empty or invalid response
        if not cards or not isinstance(cards, list) or len(cards) == 0:
            logger.warning(f"LLM returned empty flashcards for topic: {topic}, sources: {[s.get('title') for s in sources]}")
            # Create fallback flashcards - this usually means content mismatch
            source_title = sources[0].get('title', topic) if sources else topic
            cards = [
                {
                    "front": f"What are the key concepts in {source_title}?",
                    "back": f"Review the OpenStax chapter on {source_title} for detailed information about {topic}.",
                    "category": "Biology"
                },
                {
                    "front": f"Why is {topic} important in biology?",
                    "back": f"Understanding {topic} is fundamental to biology. Check the source material for specific details.",
                    "category": "Biology"
                },
            ]

        # Build proper A2UI structure programmatically
        card_ids = [f"c{i+1}" for i in range(len(cards))]
        components = [
            {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "row"]}, "distribution": "start", "alignment": "stretch"}}},
            {"id": "header", "component": {"Text": {"text": {"literalString": f"Study Flashcards: {topic}"}, "usageHint": "h3"}}},
            {"id": "row", "component": {"Row": {"children": {"explicitList": card_ids}, "distribution": "start", "alignment": "stretch"}}},
        ]
        for i, card in enumerate(cards):
            components.append({
                "id": card_ids[i],
                "component": {
                    "Flashcard": {
                        "front": {"literalString": card.get("front", "")},
                        "back": {"literalString": card.get("back", "")},
                        "category": {"literalString": card.get("category", "Biochemistry")},
                    }
                }
            })

        a2ui = [
            {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
            {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
        ]

        # Include source citation (we already verified sources exist above)
        source_info = {
            "title": sources[0].get("title", ""),
            "url": sources[0].get("url", ""),
            "provider": sources[0].get("provider", "OpenStax Biology for AP Courses"),
        }

        return json.dumps({"format": "flashcards", "a2ui": a2ui, "surfaceId": SURFACE_ID, "source": source_info})

    async def generate_quiz(
        tool_context: ToolContext,
        topic: str,
    ) -> str:
        """
        Generate personalized quiz questions as A2UI JSON.

        Args:
            topic: The topic for quiz questions (e.g., "endocrine system", "photosynthesis")

        Returns:
            A2UI JSON string for QuizCard components
        """
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )

        # Fetch OpenStax content for context
        openstax_data = fetch_openstax_content(topic)
        textbook_context = openstax_data.get("content", "")
        sources = openstax_data.get("sources", [])

        # If no OpenStax content found, return an error message instead of making up content
        if not textbook_context or not sources:
            components = [
                {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "message"]}, "distribution": "start", "alignment": "stretch"}}},
                {"id": "header", "component": {"Text": {"text": {"literalString": f"No Content Available: {topic}"}, "usageHint": "h3"}}},
                {"id": "message", "component": {"Text": {"text": {"literalString": f"Sorry, I couldn't find any OpenStax Biology content related to '{topic}'. This topic may not be covered in the AP Biology curriculum, or try rephrasing your request with more specific biology terms."}}}},
            ]
            a2ui = [
                {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
                {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
            ]
            return json.dumps({"format": "quiz", "a2ui": a2ui, "surfaceId": SURFACE_ID, "source": {"title": "No content found", "url": "", "provider": "OpenStax Biology for AP Courses"}})

        prompt = f'''Create 2 MCAT quiz questions about "{topic}" for Maria (pre-med, loves gym analogies).
Each question should have 4 options (a, b, c, d) with exactly one correct answer.
Use gym/sports analogies in explanations where appropriate.
IMPORTANT: Base all content ONLY on the textbook content provided below. Do not add information not present in the source.

Textbook source content:
{textbook_context[:4000]}'''

        quiz_schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The MCAT-style question"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "The option text"},
                                "value": {"type": "string", "description": "Option identifier (a, b, c, or d)"},
                                "isCorrect": {"type": "boolean", "description": "True if this is the correct answer"},
                            },
                            "required": ["label", "value", "isCorrect"],
                        },
                    },
                    "explanation": {"type": "string", "description": "Detailed explanation with gym analogy"},
                    "category": {"type": "string", "description": "Category like Biochemistry"},
                },
                "required": ["question", "options", "explanation", "category"],
            },
        }

        response = client.models.generate_content(
            model=model_id,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=quiz_schema,
            ),
        )
        quizzes = json.loads(response.text.strip())

        # Handle case where LLM returns empty or invalid response
        if not quizzes or not isinstance(quizzes, list) or len(quizzes) == 0:
            logger.warning(f"LLM returned empty quiz for topic: {topic}")
            # Create a default quiz question based on the source content
            quizzes = [{
                "question": f"Which of the following best describes {topic}?",
                "options": [
                    {"label": f"A key concept in {sources[0].get('title', 'biology')}", "value": "a", "isCorrect": True},
                    {"label": "A topic not covered in AP Biology", "value": "b", "isCorrect": False},
                    {"label": "An unrelated scientific concept", "value": "c", "isCorrect": False},
                    {"label": "None of the above", "value": "d", "isCorrect": False},
                ],
                "explanation": f"Review the OpenStax chapter on {sources[0].get('title', topic)} for more details.",
                "category": "Biology"
            }]

        # Build proper A2UI structure programmatically
        quiz_ids = [f"q{i+1}" for i in range(len(quizzes))]
        components = [
            {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "row"]}, "distribution": "start", "alignment": "stretch"}}},
            {"id": "header", "component": {"Text": {"text": {"literalString": f"Quick Quiz: {topic}"}, "usageHint": "h3"}}},
            {"id": "row", "component": {"Row": {"children": {"explicitList": quiz_ids}, "distribution": "start", "alignment": "stretch"}}},
        ]
        for i, quiz in enumerate(quizzes):
            # Transform options to A2UI format
            options = []
            for opt in quiz.get("options", []):
                options.append({
                    "label": {"literalString": opt.get("label", "")},
                    "value": opt.get("value", ""),
                    "isCorrect": opt.get("isCorrect", False),
                })
            components.append({
                "id": quiz_ids[i],
                "component": {
                    "QuizCard": {
                        "question": {"literalString": quiz.get("question", "")},
                        "options": options,
                        "explanation": {"literalString": quiz.get("explanation", "")},
                        "category": {"literalString": quiz.get("category", "Biochemistry")},
                    }
                }
            })

        a2ui = [
            {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
            {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
        ]

        # Include source citation (we already verified sources exist above)
        source_info = {
            "title": sources[0].get("title", ""),
            "url": sources[0].get("url", ""),
            "provider": sources[0].get("provider", "OpenStax Biology for AP Courses"),
        }

        return json.dumps({"format": "quiz", "a2ui": a2ui, "surfaceId": SURFACE_ID, "source": source_info})

    async def get_textbook_content(
        tool_context: ToolContext,
        topic: str,
    ) -> str:
        """
        Get textbook content from OpenStax Biology for AP Courses.

        Args:
            topic: The biology topic to look up (e.g., "ATP", "glycolysis", "thermodynamics")

        Returns:
            Textbook content with source citation
        """
        openstax_data = fetch_openstax_content(topic)
        content = openstax_data.get("content", "")
        sources = openstax_data.get("sources", [])

        if not content:
            return json.dumps({
                "content": f"No specific textbook content found for '{topic}'. Please use general biology knowledge.",
                "sources": []
            })

        # Format source citations
        source_citations = []
        for src in sources:
            source_citations.append({
                "title": src.get("title", ""),
                "url": src.get("url", ""),
                "provider": src.get("provider", "OpenStax Biology for AP Courses"),
            })

        return json.dumps({
            # Limit content length. Okay for a demo but could be improved
            "content": content[:4000],  
            "sources": source_citations
        })

    # GCS media URLs (publicly accessible)
    # Media bucket follows pattern: {PROJECT_ID}-media
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable must be set")
    MEDIA_BUCKET = f"{project_id}-media"
    PODCAST_URL = f"https://storage.googleapis.com/{MEDIA_BUCKET}/assets/podcast.m4a"
    VIDEO_URL = f"https://storage.googleapis.com/{MEDIA_BUCKET}/assets/video.mp4"

    async def get_audio_content(tool_context: ToolContext) -> str:
        """
        Get the personalized learning podcast as an A2UI AudioPlayer component.

        Returns:
            A2UI JSON string for AudioPlayer component
        """
        components = [
            {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "descText", "player"]}, "distribution": "start", "alignment": "stretch"}}},
            {"id": "header", "component": {"Text": {"text": {"literalString": "Personalized Learning Podcast"}, "usageHint": "h3"}}},
            {"id": "descText", "component": {"Text": {"text": {"literalString": "A podcast tailored for Maria covering ATP, bond energy, and common MCAT misconceptions. Uses gym and sports analogies to explain complex biochemistry concepts."}}}},
            {"id": "player", "component": {"AudioPlayer": {"url": {"literalString": PODCAST_URL}, "description": {"literalString": "ATP & Bond Energy - MCAT Review"}}}},
        ]

        a2ui = [
            {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
            {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
        ]

        return json.dumps({"format": "audio", "a2ui": a2ui, "surfaceId": SURFACE_ID})

    async def get_video_content(tool_context: ToolContext) -> str:
        """
        Get the personalized learning video as an A2UI Video component.

        Returns:
            A2UI JSON string for Video component
        """
        components = [
            {"id": "mainColumn", "component": {"Column": {"children": {"explicitList": ["header", "descText", "videoPlayer"]}, "distribution": "start", "alignment": "stretch"}}},
            {"id": "header", "component": {"Text": {"text": {"literalString": "Video Lesson"}, "usageHint": "h3"}}},
            {"id": "descText", "component": {"Text": {"text": {"literalString": "A visual explanation of ATP hydrolysis and bond energy concepts, designed for visual learners preparing for the MCAT."}}}},
            {"id": "videoPlayer", "component": {"Video": {"url": {"literalString": VIDEO_URL}}}},
        ]

        a2ui = [
            {"beginRendering": {"surfaceId": SURFACE_ID, "root": "mainColumn"}},
            {"surfaceUpdate": {"surfaceId": SURFACE_ID, "components": components}},
        ]

        return json.dumps({"format": "video", "a2ui": a2ui, "surfaceId": SURFACE_ID})

    # Create the agent with tools
    agent = Agent(
        name="personalized_learning_agent",
        model=model_id,
        instruction="""You are a personalized learning assistant for biology students. You help with ANY biology topic - from endocrine system to evolution, from genetics to ecology.

TOOLS AVAILABLE:
- generate_flashcards(topic) - Creates study flashcards. ALWAYS pass the user's exact topic.
- generate_quiz(topic) - Creates quiz questions. ALWAYS pass the user's exact topic.
- get_textbook_content(topic) - Gets textbook content from OpenStax for answering questions
- get_audio_content() - Plays a pre-recorded podcast about metabolism concepts
- get_video_content() - Shows a pre-recorded video lesson

CRITICAL: When user asks for flashcards or quiz on a topic, you MUST pass that EXACT topic to the tool.
Example: User says "quiz me on endocrine system" → call generate_quiz(topic="endocrine system")
Example: User says "flashcards for photosynthesis" → call generate_flashcards(topic="photosynthesis")

WHEN TO USE TOOLS - CALL IMMEDIATELY WITHOUT ASKING:
- User asks for "flashcards" → IMMEDIATELY call generate_flashcards with the EXACT topic they mentioned
- User asks for "quiz" or "test me" → IMMEDIATELY call generate_quiz with the EXACT topic they mentioned
- User asks for "podcast", "audio", or "listen" → IMMEDIATELY call get_audio_content() - DO NOT ask for confirmation
- User asks for "video", "watch", or "show me" → IMMEDIATELY call get_video_content() - DO NOT ask for confirmation

IMPORTANT: For podcast and video requests, call the tool IMMEDIATELY. Do NOT ask "would you like to listen?" or "would you like to watch?". Just call the tool right away.

LEARNER PROFILE (Maria):
- Pre-med student preparing for MCAT
- Loves sports/gym analogies
- Visual-kinesthetic learner

Always use gym/sports analogies where appropriate. Be encouraging and supportive.""",
        tools=[generate_flashcards, generate_quiz, get_textbook_content, get_audio_content, get_video_content],
    )

    # Wrap agent in AdkApp for deployment (skip App wrapper to avoid version issues)
    app = AdkApp(agent=agent, enable_tracing=True)

    print("Starting deployment (this takes 2-5 minutes)...")

    # Deploy using agent_engines.create() - the recommended API
    remote_app = agent_engines.create(
        agent_engine=app,
        display_name="Personalized Learning Agent",
        requirements=[
            "google-cloud-aiplatform[agent_engines,adk]",
            "google-genai>=1.0.0",
        ],
    )

    print(f"\n{'='*60}")
    print("DEPLOYMENT SUCCESSFUL!")
    print(f"{'='*60}")
    print(f"Resource Name: {remote_app.resource_name}")
    resource_id = remote_app.resource_name.split("/")[-1]
    print(f"Resource ID: {resource_id}")
    print(f"Context Bucket: gs://{context_bucket}/learner_context/")
    print()
    print("Next steps:")
    print("  1. Copy the Resource ID above")
    print("  2. Paste it into the notebook's AGENT_RESOURCE_ID variable")
    print(f"  3. Upload learner context files to gs://{context_bucket}/learner_context/")
    print("  4. Run the remaining notebook cells to configure and start the demo")


if __name__ == "__main__":
    main()
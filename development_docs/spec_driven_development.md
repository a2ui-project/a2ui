# **Scaling A2UI codebases with spec-driven development**

## *Status: Draft*

## *Created: 2026-06-18 Modified: 2026-06-18*

# **Background**

We need to adapt existing spec-driven development approaches to a family of codebases which implement the same specification across different languages.

# **Goals**

* Allow the A2UI team to more quickly implement features across SDK implementations in multiple languages.  
* Allow contributors outside of the core A2UI team to more efficiently write and maintain their own A2UI SDKs, for example the Jetpack Composer and Swift UI renderers.  
* Allow the A2UI team to collaborate more efficiently by standardizing the way that we record SDK and feature specifications.  
* Increase the productivity of agents working in our codebase on any task by giving them better access to relevant design documentation.  
* Make it easier for humans and agents to understand the discrepancies between different SDK codebases by emphasizing better definition of features and a clear separation between required features and optional (a.k.a. new or experimental) features.

# **Overview**

TODO: Summarize the rest of the doc in this section

We will implement spec-driven development across the team by standardizing the specification format and location within our repository, and maintaining shared SKILLs that understand how the codebases and specification relate. We will call these agent-targeted specifications “blueprints”, to differentiate them from other specifications we work with, such as the A2UI protocol specification. We separately define module specifications which describe an entire module, from feature specifications which describe modifications to a module.

Spec-driven development is primarily used for major features, e.g. the addition of a new public API, behavior, protocol version or architectural change.

Smaller features can still be implemented ad-hoc with no feature specification, if they are:

* Making changes to functionality that is not explicitly documented in the module blueprint, or

# **Document types**

## **Feature blueprint**

### **Required vs optional features**

A required feature blueprint describes a feature that is expected to be implemented in all codebases for a specific module blueprint. When a required feature blueprint is added, the associated module blueprint is updated at the same time to completely include the information required to implement the feature. The purpose of also preserving the required feature blueprint in version control is to help agents implement the feature in existing module codebases based on previous versions of the module blueprint.

An optional feature is similar to a required feature, except that the description of the feature is not baked into the module blueprint and is not expected to be implemented in all codebases.

### **Lifecycle**

Feature blueprints are typically never modified after they are created. Instead, extensions to a feature should be described by additional feature blueprints, so that they can be used to update codebases which already contain the initial version of the feature.

Feature blueprints eventually become obsolete once the feature is implemented in all codebases and can be deleted. New codebases do not need the feature blueprint, because the module blueprint contains all the information necessary to implement the feature.

### **my\_feature.blueprint.md structure**

TODO: Convert this to an example blueprint in a codeblock

Headers

* Feature name: The canonical name of the feature, used to identify it. This should be in snake case. The name of the file should exactly match the feature name.

* Module blueprints: The names of the module(s) that this feature will be implemented in. This is typically one module, but could be multiple modules e.g. for a cross-cutting feature requiring changes to the Core SDK *and* inference SDK for example.

* Required feature: No

* Date added

Content

* Requirements

* Detailed description of changes

* Links

* Test cases, including references to platform-agnostic conformance test data

* Implementation steps

* Checklist

## **Optional feature blueprint**

## **Module blueprint**

This is a blueprint that can be used to implement a new codebase. It describes the codebase in a language-agnostic way.

### **Blueprint file content**

* Name  
* Code location  
* Included features

### **Conformance test content**

## **Codebase**

## **Codebase blueprint**

This file is stored in the actual codebase that it is relevant to, so that it can be discovered easily, and to allow for some code to be stored in different repos than the main repo.

Headers

* Included features  
* Name of the associated module blueprint  
* list of required and optional features that are implemented

Content

Explains any technical decisions that were made for this codebase that are not directly specified in the module blueprint. E.g. because the module blueprint was ambiguous, or there was a reason to override it for codebase-specific reasons.

# **Developer journeys**

This section explains what steps will be taken by developers and agents to perform common tasks in spec-driven development

## **Specify a new required feature**

1. Create required feature blueprint **(significant human input required)**  
2. Update module blueprint based on the feature blueprint, to ensure the module blueprint fully specifies the feature and how to implement it. Add the feature name to the module’s “included features”. (coding agent)

## **Specify a new optional feature**

1. Create optional feature blueprint **(significant human input required)**

## **Promote an optional feature to be required**

1. Update module blueprint based on the feature blueprint, and add it to the module’s “included\_features”. (coding agent)

## **Implement an optional or required feature in a codebase**

1. Verify that the codebase does not already contain the feature  
2. Create a temporary design describing in detail how the feature should be implemented in the specific codebase, taking into account the feature blueprint, the codebase blueprint, and the actual codebase code. This file should not be checked in. **(human input required)**  
3. Use the temporary design to implement the feature  
4. Update the codebase blueprint to add the feature to the “included\_features” and include any codebase specific decisions that were made as part of the feature implementation 

## **Implement all the features necessary to bring a codebase “up to date”**

1. Read the codebase blueprint and module blueprint and identify all the required features in the module that are not in the codebase.  
2. Implement each feature in chronological order, based on their blueprints, following the steps to implement a feature above.  
3. Consult the module blueprint and verify that the codebase now matches it, making minor changes to the codebase as necessary to make it as consistent as possible to the module blueprint.  
4. Update the codebase blueprint to add the feature to the “included\_features”.

## **Resolve inconsistencies between a module blueprint and all of its associated codebases**

1. Read the relevant module blueprint  
2. Search for all codebases that associated with the module  
3. Analyse every codebase associated with the module, identifying:  
   1. Required features that are missing from each codebase  
   2. Discrepancies between the blueprint and the actual implementation e.g. API names or structures which are inconsistent  
   3. Discrepancies between the codebases, for which the module blueprint provides no guidance.  
4. Report the above and propose actions to take to reduce the inconsistencies including:  
   1. Adding additional detail to the blueprints to reduce ambiguity  
   2. Update the module blueprint to explicitly mark a detail as being a codebase-level decision  
   3. Updating codebases to match the module blueprints  
   4. Update the codebase blueprint to document a reason that it has intentionally deviated from the module blueprint for a language-specific reason.  
5. Implement some of the proposed actions, based on human discretion **(significant human input required)**

## **Implement a new codebase**

1. Create a temporary design describing in detail how the codebase should be implemented based on the module blueprint. **(significant human input required)**  
2. Implement the module based on the temporary design  
3. Create a new codebase blueprint, summarizing the design of details that are not specified in the module blueprint.

## **Clean up feature blueprints**

# **Implementation**

## **Folder structure**

TODO: include a detailed proposal of where specs should live.

* I think it should be in a top-level “blueprints” folder which has all module blueprints and feature blueprints

## **Skills**

TODO: describe a set of skills that should be  

## **Blueprint validation**

We will implement a blueprint validator script that verifies that all blueprints conform to the format described above, e.g. they include all the required headers in the expected format, and follow the expected file structure (e.g. name and filename match). This should be easy to trigger via a script, and should be run on CI to block submission of invalid blueprints.

## **Bootstrap tasks**

Lists the tasks that are necessary to set up this system.

TODO: Fill this out, including

* Setting up folders, with readmes  
* Setting up validation  
* Write skills  
* Migrating existing module specifications, e.g from specification/v1\_0/docs/renderer\_guide.md etc to be module specifications.
A Trustworthy Module Registry
=========================
## About
This repository contains the implementation of a next-generation package registry designed to address the limitations of existing solutions like npm while providing developers with improved features, transparency, and control over their dependencies.

## Table of Contents
- [Key Features](#key-features)
- [Version Support](#Version-Support)
- [Installation](#installation)
- [License](#license)

## Key Features
### Core Functionalities
1. Upload, Update, Rate, and Download Packages:
	Support for uploading and updating packages in the form of zipped files.
	Rating system based on:
	Fraction of dependencies pinned to a specific major+minor version.
	Fraction of project code introduced via pull requests with code review.
2. Debloat Option:
   	Optimizes uploaded packages by removing unnecessary code, reducing storage costs.
3. Fetch Package Versions:
	Retrieve available versions of a package using:
		Exact notation (e.g., 1.2.3).
		Ranges (e.g., 1.2.3-2.1.0 or ~1.2.0).
4. Public NPM Ingestion:
	Import public npm packages based on predefined quality thresholds.
5. Dependency Size Analysis:
	Calculate the size of a package and its transitive dependencies in terms of zipped files.
6. Registry Reset:
	Reset the registry to a default state with no uploaded packages.
### For Developers
RESTful API compliant with the OpenAPI schema for programmatic access.
Web browser interface for easy interaction by non-technical users.

### Metrics
### Bus Factor
This feature determines the bus factor of packages. It is used to find out how much of an impact it would make if contributors to a package were to ‘get hit by a bus’. Of course, this is not literal. Hopefully. What this does is deliver a score based on how much a package may suffer if it were to lose contributors. The calculation is based on the number of total contributors to a repository, then normalized using a set minimum and maximum number of acceptable contributors. We have set the minimum to be 10 to account for every contributor being active, and the maximum is 100 to account for a large number of contributors being inactive. 

### Correctness
This feature determines the correctness of a package. This is done by finding the total number of issues of all states, and then calculating the percentage of closed issues. The more issues that are left unresolved will lower the score.

The returned score is dependent on the percentage of issues resolved. It will range from 0 to 1.

### Ramp Up
This feature determines how likely it is to ‘ramp up’ people on packages. It is used to find out how detailed, informational, and efficient README.md files are and delivers a score on how quickly and effectively people can get up to speed on packages.

Scores range from 0 to 1. 0 being awfully inadequate and 1 being absolute perfection.  

### Responsive Maintainers
This feature calculates the average time it takes for contributors to respond to an issue. This is done through monitoring comment timestamps. 

If the average issue response time is under 24 hours, then a score of 1 is returned. From there, 0.25 points will be deducted from the score for each additional 24 hours.

### License Compatibility
This feature determines if a package has a license. It simply returns a score of 1 if it contains a license and a score of 0 if there is no mention of one.

### Fraction of Dependencies 
This feature calculates the fraction of dependencies that are pinned to at least a specific major+minor version, e.g., version 2.3.X of the dependency.

### Fraction of Project Code
This feature calculates the fraction of project code that was introduced through pull requests with a code review.

### Net Score
The net score is calculated first using the license compatibility score as a check condition to see if the net score should already be set to zero. If the license is compatible, then the net score is calculated as a weighted sum of the remaining four metrics.
-  NetScore = License * (0.2*RampUp + 0.3*Correctness + 0.2*BusFactor + 0.3*ResponsiveMaintainers)

## Installation
git clone https://github.com/ECE-461-Team-16/ACME-Phase-2.git
Install dependencies ./run install 


## License
Released under the LGPLv2.1 license.


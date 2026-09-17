// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// Types of climbing available at a location.
enum ClimbingType {
  /// Climbing short walls without ropes over pads.
  bouldering('Bouldering'),

  /// Climbing with a rope anchored at the top.
  topRope('Top Rope'),

  /// Climbing while clipping the rope into protection on the way up.
  lead('Lead'),

  /// Climbing up cracks using specialized technique.
  crack('Crack');

  const ClimbingType(this.displayName);

  /// The user-friendly name of the climbing type.
  final String displayName;
}

/// Experience ranges for routes at a location.
enum ExperienceRange {
  /// Easy routes suitable for first-timers and novices.
  beginner('Beginner'),

  /// Moderately challenging routes for climbers with some experience.
  intermediate('Intermediate'),

  /// Challenging routes for seasoned climbers.
  advanced('Advanced');

  const ExperienceRange(this.displayName);

  /// The user-friendly name of the experience range.
  final String displayName;
}

/// Properties or features of a climbing location.
enum LocationProperty {
  /// Located indoors.
  indoor('Indoor'),

  /// Located outdoors.
  outdoor('Outdoor'),

  /// Free to access.
  free('Free'),

  /// Requires payment to access.
  paid('Paid'),

  /// Requires a permit to climb.
  permitRequired('Permit Required');

  const LocationProperty(this.displayName);

  /// The user-friendly name of the property.
  final String displayName;
}

/// Information about a climbing location.
class ClimbingLocationInfo {
  const ClimbingLocationInfo({
    required this.identifier,
    required this.image,
    required this.name,
    required this.address,
    required this.climbingTypes,
    required this.experienceRanges,
    required this.properties,
  });

  final String identifier;
  final String image;
  final String name;
  final String address;

  /// Types of climbing available at this location.
  final List<ClimbingType> climbingTypes;

  /// Experience ranges for routes at this location.
  final List<ExperienceRange> experienceRanges;

  /// Properties or features of this location.
  final List<LocationProperty> properties;
  Map<String, dynamic> toJson() {
    return {
      'identifier': identifier,
      'image': image,
      'name': name,
      'address': address,
      'climbingTypes': climbingTypes.map((e) => e.name).toList(),
      'experienceRanges': experienceRanges.map((e) => e.name).toList(),
      'properties': properties.map((e) => e.name).toList(),
    };
  }
}

/// A global list of climbing locations.
List<ClimbingLocationInfo> climbingLocations = [
  const ClimbingLocationInfo(
    identifier: 'calico_hills_i',
    image: 'mountain_01.webp',
    name: 'Calico Hills I',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.topRope],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'kraft_boulders',
    image: 'mountain_02.webp',
    name: 'Kraft Boulders',
    address: 'Calico Basin, NV',
    climbingTypes: [ClimbingType.bouldering],
    experienceRanges: [
      ExperienceRange.beginner,
      ExperienceRange.intermediate,
      ExperienceRange.advanced,
    ],
    properties: [LocationProperty.outdoor, LocationProperty.free],
  ),
  const ClimbingLocationInfo(
    identifier: 'sandstone_quarry',
    image: 'mountain_03.webp',
    name: 'Sandstone Quarry',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.crack],
    experienceRanges: [ExperienceRange.intermediate, ExperienceRange.advanced],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'black_velvet_canyon',
    image: 'mountain_04.webp',
    name: 'Black Velvet Canyon',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.crack],
    experienceRanges: [ExperienceRange.advanced],
    properties: [
      LocationProperty.outdoor,
      LocationProperty.free,
      LocationProperty.permitRequired,
    ],
  ),
  const ClimbingLocationInfo(
    identifier: 'willow_springs',
    image: 'mountain_05.webp',
    name: 'Willow Springs',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.bouldering],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'icebox_canyon',
    image: 'mountain_06.webp',
    name: 'Icebox Canyon',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.crack, ClimbingType.lead],
    experienceRanges: [ExperienceRange.advanced],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'pine_creek_canyon',
    image: 'mountain_07.webp',
    name: 'Pine Creek Canyon',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.crack],
    experienceRanges: [ExperienceRange.intermediate, ExperienceRange.advanced],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'the_gallery',
    image: 'mountain_08.webp',
    name: 'The Gallery',
    address: 'Calico Hills, Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead],
    experienceRanges: [ExperienceRange.intermediate, ExperienceRange.advanced],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'magic_bus',
    image: 'mountain_09.webp',
    name: 'Magic Bus',
    address: 'Calico Hills, Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.topRope],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'the_hamlet',
    image: 'mountain_10.webp',
    name: 'The Hamlet',
    address: 'Calico Hills, Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'moderate_mecca',
    image: 'mountain_11.webp',
    name: 'Moderate Mecca',
    address: 'Calico Hills, Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead, ClimbingType.topRope],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'the_black_corridor',
    image: 'mountain_12.webp',
    name: 'The Black Corridor',
    address: 'Red Rock Canyon, NV',
    climbingTypes: [ClimbingType.lead],
    experienceRanges: [ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'origin_climbing_fitness',
    image: 'mountain_13.webp',
    name: 'Origin Climbing + Fitness',
    address: '7585 S Rainbow Blvd, Las Vegas, NV',
    climbingTypes: [
      ClimbingType.bouldering,
      ClimbingType.lead,
      ClimbingType.topRope,
    ],
    experienceRanges: [
      ExperienceRange.beginner,
      ExperienceRange.intermediate,
      ExperienceRange.advanced,
    ],
    properties: [LocationProperty.indoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'the_refuge_climbing_center',
    image: 'mountain_14.webp',
    name: 'The Refuge Climbing Center',
    address: '6283 S Valley View Blvd, Las Vegas, NV',
    climbingTypes: [ClimbingType.bouldering],
    experienceRanges: [
      ExperienceRange.beginner,
      ExperienceRange.intermediate,
      ExperienceRange.advanced,
    ],
    properties: [LocationProperty.indoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'red_rock_climbing_center',
    image: 'mountain_15.webp',
    name: 'Red Rock Climbing Center',
    address: '8201 W Charleston Blvd, Las Vegas, NV',
    climbingTypes: [
      ClimbingType.lead,
      ClimbingType.topRope,
      ClimbingType.bouldering,
    ],
    experienceRanges: [
      ExperienceRange.beginner,
      ExperienceRange.intermediate,
      ExperienceRange.advanced,
    ],
    properties: [LocationProperty.indoor, LocationProperty.paid],
  ),
  const ClimbingLocationInfo(
    identifier: 'lone_mountain',
    image: 'mountain_16.webp',
    name: 'Lone Mountain',
    address: 'Las Vegas, NV',
    climbingTypes: [ClimbingType.lead],
    experienceRanges: [ExperienceRange.beginner, ExperienceRange.intermediate],
    properties: [LocationProperty.outdoor, LocationProperty.free],
  ),
  const ClimbingLocationInfo(
    identifier: 'mount_charleston',
    image: 'mountain_17.webp',
    name: 'Mount Charleston',
    address: 'Mt Charleston, NV',
    climbingTypes: [ClimbingType.lead],
    experienceRanges: [ExperienceRange.intermediate, ExperienceRange.advanced],
    properties: [LocationProperty.outdoor, LocationProperty.free],
  ),
];

# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-23

### Added

- FreshRSS in Gladys, over its Google Reader compatible API and an API
  password: a **FreshRSS** device (unread articles, online), one device per
  category and one per feed (their unread articles).
- **New article** scene trigger, filtered by category, feed or a keyword of the
  title, with the title, link, feed and article id for the actions.
- Scene actions: mark a category, a feed or everything as read, mark articles
  as read by id, read the newest unread titles for a message.
- **FreshRSS** dashboard widget: unread count, newest unread articles, Refresh
  and Mark as read buttons.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-freshrss/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-freshrss/releases/tag/v1.0.0

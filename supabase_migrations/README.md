# PAP Magazine - Database Migration Guide

## Execution Order

Run these SQL files in Supabase Dashboard > SQL Editor, in this exact order:

| Step | File | Description |
|------|------|-------------|
| 1 | `000_prerequisites.sql` | Profiles, admin_users, is_admin(), subscriptions, submissions, pullletters, storage bucket |
| 2 | `001_create_tables.sql` | Films & articles tables with RLS and indexes |
| 3 | `002_full_data_migration.sql` | INSERT all 141 films + 317 articles (includes CREATE IF NOT EXISTS, safe to run after step 2) |
| 4 | `003_editorials_table.sql` | Editorials table (depends on admin_users from step 1) |
| 5 | `004_all_content_tables.sql` | Creators, shorts, banners, cover_slides, site_settings |
| 6 | `../frontend/js/supabase-schema-community.sql` | Community tables: posts, comments, likes, views, checkins, projects, applications (depends on profiles from step 1) |
| 9 | `009_community_v3_playground.sql` | Community playground primitives: scraps table + mood_boards.inspired_by_id |
| 10 | `010_pullletters_extend.sql` | Extends existing `pullletters` table with moodboard linkage + private storage bucket for issued PDFs |
| 11 | `011_pullletters_proposal_team.sql` | Adds `team_info` JSONB + `proposal_pdf_url` for the formal 촬영시안 + team-credits flow |
| 12 | `012_editorial_views.sql` | `editorial_views` append-only table + `trending_editorials()` RPC for the home "인기 에디토리얼" row |

## Skip List

- `001_films_articles.sql` - DEPRECATED, do not run

## After Migration

1. Add yourself as admin: `INSERT INTO admin_users (user_id) VALUES ('your-auth-user-uuid');`
2. Verify tables: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`

## Expected Tables (17 total)

profiles, admin_users, subscriptions, submissions, pullletters, films, articles, editorials, creators, shorts, banners, cover_slides, site_settings, community_posts, community_comments, community_likes, community_post_views, community_checkins, community_projects, community_applications

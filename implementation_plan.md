# Implementation Plan - Fix Dashboard & Improve Mobile UI

The BorrowHub dashboard fails to load because several required backend endpoints (`/api/borrow-requests`, `/api/writing-requests`, `/api/writer-profiles`) are missing from `backend/server-db.js`, returning `404 Not Found` errors. In addition, the mobile UI needs responsive design improvements for seamless smartphone browsing.

## User Review Required

> [!IMPORTANT]
> - **Backend API Endpoints**: Implementing `GET /api/borrow-requests`, `GET /api/writing-requests`, `POST /api/writing-requests`, and `GET /api/writer-profiles` in `backend/server-db.js` will resolve the `404` errors breaking the dashboard.
> - **Database Table Auto-Creation**: `writer_profiles` table schema will be auto-ensured during database initialization if it does not already exist.

## Proposed Changes

---

### Backend API (`backend/server-db.js`)

#### [MODIFY] [server-db.js](file:///d:/Borrowhub/backend/server-db.js)
- Add `CREATE TABLE IF NOT EXISTS writer_profiles` during database initialization.
- Implement `GET /api/borrow-requests`: Supports filtering by `borrower_id` and `owner_id`, joining `items` and `users` to provide `item_name`, `borrower_name`, `owner_name`, `start_date`, `end_date`, `total_price`, `payment_status`, and `status`.
- Implement `GET /api/writing-requests`: Supports filtering by `status`, joining `users` for `student_name`.
- Implement `POST /api/writing-requests`: Allows students to submit new academic writing requests (`title`, `subject`, `type`, `description`, `length_pages`, `budget`, `deadline`).
- Implement `GET /api/writer-profiles`: Joins `users` with `writer_profiles` for users with role `writer` or `both`, returning complete profile data (`name`, `bio`, `subjects`, `price_per_page`, `is_verified`, `avg_rating`, `completed_orders`).

---

### Frontend Styling (`frontend/style.css`) & Layout (`frontend/dashboard.html`, `frontend/app.js`)

#### [MODIFY] [style.css](file:///d:/Borrowhub/frontend/style.css)
- **Mobile Bottom Navigation**: Enhance fixed bottom navigation with modern active pill highlights, smooth icon scale transitions, backdrop blur, and `env(safe-area-inset-bottom)` support.
- **Mobile Modals & Bottom Sheets**: Style dialogs on mobile screens (< 640px) as slide-up bottom sheets with rounded top corners, proper touch close targets, and scrollable content containers.
- **Touch-Friendly Hit Targets**: Ensure buttons, dropdowns, inputs, and action links meet minimum 44px touch target guidelines (`min-height: 44px`, `touch-action: manipulation`).
- **Responsive Tables & Cards**: Polish card layouts, grid spacing, badge pill styling, and table scroll wrappers for mobile viewports.
- **Drawer & Header Polish**: Improve mobile topbar spacing, brand logo presentation, user avatar badge, and sliding navigation drawer styling.

#### [MODIFY] [dashboard.html](file:///d:/Borrowhub/frontend/dashboard.html)
- Optimize mobile header layout, active tab indicators, and mobile bottom navigation structure for touch responsiveness.

## Verification Plan

### Automated / API Verification
1. Start `node backend/server-db.js`.
2. Execute HTTP fetch queries against:
   - `http://localhost:5000/api/items?available=true`
   - `http://localhost:5000/api/writing-requests?status=open`
   - `http://localhost:5000/api/writer-profiles`
   - `http://localhost:5000/api/borrow-requests?borrower_id=1`
3. Verify all endpoints return `200 OK` with valid JSON data structures instead of `404 Not Found`.

### Manual & Mobile Verification
1. Open dashboard page `http://localhost:5000/dashboard` in browser.
2. Confirm the dashboard page loads statistics, borrow requests, and recent items without error.
3. Test mobile viewport dimensions (e.g. 375px, 390px, 414px):
   - Verify mobile bottom navigation tabs, active state highlighting, and List item shortcut button.
   - Verify sidebar drawer toggle and backdrop overlay.
   - Verify modal forms (login, post writing request, item creation) display cleanly on mobile screens.

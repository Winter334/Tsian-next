package middleware

import (
	"database/sql"
	"errors"
	"net/http"

	"tsian/platform-server/internal/admin"
	"tsian/platform-server/internal/auth"
	"tsian/platform-server/internal/user"
)

func RequireAdmin(db *sql.DB, users user.Repository, authorizer *admin.Authorizer, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil || cookie.Value == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		userID, err := auth.ValidateSession(db, cookie.Value)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			http.Error(w, "session validation failed", http.StatusInternalServerError)
			return
		}

		account, err := users.FindByID(r.Context(), userID)
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			http.Error(w, "user lookup failed", http.StatusInternalServerError)
			return
		}

		allowed, err := authorizer.IsAdmin(r.Context(), db, account.ID)
		if err != nil {
			http.Error(w, "admin lookup failed", http.StatusInternalServerError)
			return
		}
		if !allowed {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r.WithContext(user.ContextWithUser(r.Context(), account)))
	})
}

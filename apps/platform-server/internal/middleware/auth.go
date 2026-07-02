package middleware

import (
	"database/sql"
	"errors"
	"net/http"

	"tsian/platform-server/internal/auth"
	"tsian/platform-server/internal/user"
)

func RequireAuth(db *sql.DB, users user.Repository, next http.Handler) http.Handler {
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

		next.ServeHTTP(w, r.WithContext(user.ContextWithUser(r.Context(), account)))
	})
}

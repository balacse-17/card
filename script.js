const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const feedbackForm = document.getElementById('feedbackForm');
const feedbackList = document.getElementById('feedbackList');
const registerStatus = document.getElementById('registerStatus');
const loginStatus = document.getElementById('loginStatus');
const feedbackStatus = document.getElementById('feedbackStatus');
const refreshBtn = document.getElementById('refreshBtn');

let authToken = '';
let loggedInUser = '';

function setAuth(token, username) {
  authToken = token;
  loggedInUser = username;
}

async function loadFeedback() {
  if (!authToken) {
    feedbackList.innerHTML = '<li>Login required to load feedback.</li>';
    return;
  }

  feedbackList.innerHTML = '<li>Loading feedback...</li>';

  try {
    const response = await fetch('/api/feedback', {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to fetch feedback.');
    }

    if (data.length === 0) {
      feedbackList.innerHTML = '<li>No feedback yet.</li>';
      return;
    }

    feedbackList.innerHTML = data
      .map(
        (item) => `
          <li>
            <strong>${item.username}</strong> (${item.rating}/5)
            <p>${item.message}</p>
            <p class="meta">${new Date(item.createdAt).toLocaleString()}</p>
          </li>
        `
      )
      .join('');
  } catch (error) {
    feedbackList.innerHTML = `<li>${error.message}</li>`;
  }
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(registerForm);
  const payload = {
    username: formData.get('username').trim(),
    password: formData.get('password').trim()
  };

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Registration failed.');
    }

    registerStatus.textContent = `Registered user ${data.username}. You can now login.`;
    registerForm.reset();
  } catch (error) {
    registerStatus.textContent = error.message;
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const payload = {
    username: formData.get('username').trim(),
    password: formData.get('password').trim()
  };

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Login failed.');
    }

    setAuth(data.token, data.user.username);
    loginStatus.textContent = `Logged in as ${loggedInUser}.`;
    feedbackStatus.textContent = '';
    await loadFeedback();
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  if (!authToken) {
    loginStatus.textContent = 'You are not logged in.';
    return;
  }

  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Logout failed.');
    }

    setAuth('', '');
    loginStatus.textContent = data.message;
    feedbackList.innerHTML = '<li>Login required to load feedback.</li>';
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!authToken) {
    feedbackStatus.textContent = 'Please login first.';
    return;
  }

  const formData = new FormData(feedbackForm);
  const payload = {
    message: formData.get('message').trim(),
    rating: Number(formData.get('rating'))
  };

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Unable to submit feedback.');
    }

    feedbackStatus.textContent = 'Feedback submitted successfully.';
    feedbackForm.reset();
    await loadFeedback();
  } catch (error) {
    feedbackStatus.textContent = error.message;
  }
});

refreshBtn.addEventListener('click', loadFeedback);

loadFeedback();

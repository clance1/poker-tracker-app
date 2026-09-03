import { render, screen } from '@testing-library/react';
import App from './App';

test('signed-out visitors see the login form', () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByPlaceholderText('Enter username')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Enter password')).toHaveAttribute('type', 'password');
  expect(screen.getAllByRole('button', { name: 'Sign In' })).toHaveLength(2);
});

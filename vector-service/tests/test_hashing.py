from app.auth.hashing import hash_password, verify_password


def test_hash_differs_from_plaintext():
    hashed = hash_password("correct-horse-battery-staple")
    assert hashed != "correct-horse-battery-staple"
    assert len(hashed) > 20


def test_verify_matching_password():
    hashed = hash_password("s3cret!")
    assert verify_password("s3cret!", hashed) is True


def test_verify_rejects_wrong_password():
    hashed = hash_password("s3cret!")
    assert verify_password("wrong-password", hashed) is False


def test_hash_is_salted_differently_each_time():
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b
    assert verify_password("same-password", a)
    assert verify_password("same-password", b)

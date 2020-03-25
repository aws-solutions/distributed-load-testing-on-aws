FROM loadimpact/k6

USER root

# Install python, pip, and awscli
RUN apk --no-cache add \
    python \
    python-dev \
    py-pip \
    build-base \
  && pip install --no-cache-dir awscli

ADD ./load-test.sh /k6-tests/
RUN chmod 755 /k6-tests/load-test.sh
ADD ./*.js /k6-tests/

ENTRYPOINT ["sh", "-c", "/k6-tests/load-test.sh"]

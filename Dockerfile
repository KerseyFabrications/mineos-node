FROM ubuntu:26.04
LABEL MAINTAINER='William Dizon <wdchromium@gmail.com>'

#update and accept all prompts
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
  supervisor \
  rdiff-backup \
  screen \
  rsync \
  git \
  curl \
  rlwrap \
  unzip \
  openjdk-25-jre-headless \
  openjdk-21-jre-headless \
  openjdk-8-jre-headless \
  ca-certificates-java \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

#make Java 25 the default `java` on PATH; 21 and 8 stay available at fixed paths
#for a server's [java] java_binary:
#  /usr/lib/jvm/java-25-openjdk-<arch>/bin/java
#  /usr/lib/jvm/java-21-openjdk-<arch>/bin/java
#  /usr/lib/jvm/java-8-openjdk-<arch>/jre/bin/java
RUN ARCH="$(dpkg --print-architecture)" \
  && update-alternatives --set java /usr/lib/jvm/java-25-openjdk-${ARCH}/bin/java \
  && /usr/lib/jvm/java-25-openjdk-${ARCH}/bin/java -version \
  && /usr/lib/jvm/java-21-openjdk-${ARCH}/bin/java -version \
  && /usr/lib/jvm/java-8-openjdk-${ARCH}/jre/bin/java -version \
  && java -version 2>&1 | grep -q '"25'

#install node from nodesource following instructions: https://github.com/nodesource/distributions#debinstall
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

#install mineos from this build context (not a fresh clone of upstream master,
#so the image carries the code and package.json of the branch being built).
COPY . /usr/games/minecraft
RUN cd /usr/games/minecraft \
  && cp mineos.conf /etc/mineos.conf \
  && chmod +x webui.js mineos_console.js service.js

#build npm deps and clean up apt for image minimalization
RUN cd /usr/games/minecraft \
  && apt-get update \
  && apt-get install -y build-essential \
  && npm ci --omit=dev --no-audit --no-fund \
  && apt-get remove --purge -y build-essential \
  && apt-get autoremove -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

#configure and run supervisor
RUN cp /usr/games/minecraft/init/supervisor_conf /etc/supervisor/conf.d/mineos.conf
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]

#entrypoint allowing for setting of mc password
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

EXPOSE 8443 25565-25570
VOLUME /var/games/minecraft

ENV USER_PASSWORD=random_see_log USER_NAME=mc USER_UID=1000 USE_HTTPS=true SERVER_PORT=8443
